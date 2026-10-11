//! The desktop host's private channel to the native Tachiko Work runtime.
//!
//! The renderer's `NativeRuntimeChannel` sends one framed operation at a time.
//! This module only validates the frame, fences it to the current channel
//! generation and routes it to the Work-owned `DesignerHost`; it adds no
//! meaning, validation, revision or publication of its own.
//!
//! Frames, little-endian:
//! - request: `[u32 header][header JSON][u32 request][request bytes][payload]`
//! - reply: `[u32 reply][reply JSON][payload]`

use std::panic::{AssertUnwindSafe, catch_unwind};
use std::sync::{Condvar, Mutex, MutexGuard};

use serde::Deserialize;
use tachiko_designer_runtime::host_bridge::{
    DesignerHost, HostReply, MAX_HOST_PROJECT_TRANSFER_BYTES, MAX_HOST_SPREADSHEET_REQUEST_BYTES,
};

/// The header carries only a kind and a generation number.
const MAX_HEADER_BYTES: usize = 1024;

#[derive(Debug, PartialEq, Eq)]
pub enum ChannelError {
    /// The frame did not have the agreed shape or limits; nothing ran.
    Frame(&'static str),
    /// The frame belongs to an older channel generation; nothing ran.
    StaleGeneration,
    /// The runtime panicked; its resident occurrence was discarded.
    RuntimeStopped,
    /// The window is closing or reloading; no further operation may change the work.
    Sealed,
}

impl std::fmt::Display for ChannelError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Frame(reason) => write!(formatter, "invalid runtime frame: {reason}"),
            Self::StaleGeneration => formatter.write_str("the runtime channel was replaced"),
            Self::RuntimeStopped => {
                formatter.write_str("the runtime stopped and its work was discarded")
            }
            Self::Sealed => formatter.write_str("Tachiko Sheet is closing"),
        }
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct FrameHeader {
    kind: String,
    generation: u64,
}

struct ChannelState {
    generation: u64,
    host: DesignerHost,
}

/// Whether new operations may reach the runtime.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Phase {
    Open,
    /// Leaving is being decided: operations wait, so none can slip in after
    /// the page reported its unsaved state.
    Held,
    /// Leaving is decided: operations are refused.
    Sealed,
}

struct Gate {
    phase: Phase,
    /// Operations that arrived while held and are waiting for the decision.
    waiting: usize,
}

/// One native runtime shared by the app's single Sheet window.
pub struct RuntimeChannel {
    state: Mutex<ChannelState>,
    gate: Mutex<Gate>,
    gate_changed: Condvar,
}

impl Default for RuntimeChannel {
    fn default() -> Self {
        Self {
            state: Mutex::new(ChannelState {
                generation: 0,
                host: DesignerHost::new(),
            }),
            gate: Mutex::new(Gate {
                phase: Phase::Open,
                waiting: 0,
            }),
            gate_changed: Condvar::new(),
        }
    }
}

impl RuntimeChannel {
    /// Start a new generation with an empty runtime. Any resident occurrence
    /// and every frame from an earlier generation become unreachable. A new
    /// page starts with the gate open.
    pub fn attach(&self) -> u64 {
        let mut state = self.lock();
        state.generation += 1;
        state.host = DesignerHost::new();
        self.set_phase(Phase::Open);
        state.generation
    }

    /// Hold new operations while closing or reloading is being decided.
    pub fn hold(&self) {
        self.set_phase(Phase::Held);
    }

    /// The person kept the work open: let held operations run.
    pub fn release(&self) {
        self.set_phase(Phase::Open);
    }

    /// Seal only if no operation is waiting at the gate. An operation that
    /// arrived after the page reported "clean" makes that report stale.
    pub fn seal_if_idle(&self) -> bool {
        let mut gate = lock_gate(&self.gate);
        if gate.waiting > 0 {
            return false;
        }
        gate.phase = Phase::Sealed;
        self.gate_changed.notify_all();
        true
    }

    /// Refuse every later operation; leaving is decided.
    pub fn seal(&self) {
        self.set_phase(Phase::Sealed);
    }

    fn set_phase(&self, phase: Phase) {
        lock_gate(&self.gate).phase = phase;
        self.gate_changed.notify_all();
    }

    /// Wait while held; refuse once sealed.
    fn admit(&self) -> Result<(), ChannelError> {
        let mut gate = lock_gate(&self.gate);
        gate.waiting += 1;
        while gate.phase == Phase::Held {
            gate = self
                .gate_changed
                .wait(gate)
                .unwrap_or_else(std::sync::PoisonError::into_inner);
        }
        gate.waiting -= 1;
        if gate.phase == Phase::Sealed {
            return Err(ChannelError::Sealed);
        }
        Ok(())
    }

    /// Run one framed operation for the current generation.
    pub fn dispatch(&self, frame: &[u8]) -> Result<Vec<u8>, ChannelError> {
        let (header, request, payload) = parse_frame(frame)?;
        self.admit()?;
        let mut state = self.lock();
        if header.generation != state.generation {
            return Err(ChannelError::StaleGeneration);
        }
        let host = &mut state.host;
        match catch_unwind(AssertUnwindSafe(|| {
            route(host, &header.kind, request, payload)
        })) {
            Ok(Some(reply)) => Ok(encode_reply(reply)),
            Ok(None) => Err(ChannelError::Frame("unknown operation kind")),
            Err(_) => {
                // A panic may have left the occurrence half-updated. Discard it
                // and end this generation; the renderer reports an unknown outcome.
                state.generation += 1;
                state.host = DesignerHost::new();
                Err(ChannelError::RuntimeStopped)
            }
        }
    }

    fn lock(&self) -> MutexGuard<'_, ChannelState> {
        // Panics are caught inside the lock, so poisoning can only come from a
        // bug in this module; recover the state rather than wedging the app.
        self.state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

fn lock_gate(gate: &Mutex<Gate>) -> MutexGuard<'_, Gate> {
    gate.lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

fn route(host: &mut DesignerHost, kind: &str, request: &[u8], payload: &[u8]) -> Option<HostReply> {
    let reply = |reply: Vec<u8>| HostReply { reply, bytes: None };
    Some(match kind {
        "command" => reply(host.request(request)),
        "spreadsheet" => host.spreadsheet(request, payload),
        "inspect_project" => reply(host.inspect_project(payload)),
        "open_project" => reply(host.open_project(payload, request)),
        "open_local_document" => reply(host.open_local_document(payload, request)),
        "open_portable_ro" => reply(host.open_portable_ro(payload, request)),
        "verify_portable_ro" => reply(host.verify_portable_ro(payload)),
        "export_project" => host.export_project(request),
        "export_project_v3" => host.export_project_v3(request),
        "export_canonical_tree" => host.export_canonical_tree(request),
        "export_portable_ro" => host.export_portable_ro(request),
        "observe_occurrence" => reply(host.observe_occurrence()),
        "close_project" => {
            host.close_project();
            reply(br#"{"status":"closed"}"#.to_vec())
        }
        _ => return None,
    })
}

fn read_section<'frame>(
    frame: &'frame [u8],
    offset: &mut usize,
    maximum: usize,
) -> Result<&'frame [u8], ChannelError> {
    let length_end = offset
        .checked_add(4)
        .ok_or(ChannelError::Frame("truncated"))?;
    let length = frame
        .get(*offset..length_end)
        .ok_or(ChannelError::Frame("truncated"))?;
    let length = u32::from_le_bytes([length[0], length[1], length[2], length[3]]) as usize;
    if length > maximum {
        return Err(ChannelError::Frame("section exceeds its limit"));
    }
    let end = length_end
        .checked_add(length)
        .ok_or(ChannelError::Frame("truncated"))?;
    let section = frame
        .get(length_end..end)
        .ok_or(ChannelError::Frame("truncated"))?;
    *offset = end;
    Ok(section)
}

fn parse_frame(frame: &[u8]) -> Result<(FrameHeader, &[u8], &[u8]), ChannelError> {
    let mut offset = 0;
    let header = read_section(frame, &mut offset, MAX_HEADER_BYTES)?;
    let header: FrameHeader =
        serde_json::from_slice(header).map_err(|_| ChannelError::Frame("invalid header"))?;
    let request = read_section(frame, &mut offset, MAX_HOST_SPREADSHEET_REQUEST_BYTES)?;
    let payload = &frame[offset..];
    if payload.len() > MAX_HOST_PROJECT_TRANSFER_BYTES {
        return Err(ChannelError::Frame("payload exceeds the transfer limit"));
    }
    Ok((header, request, payload))
}

fn encode_reply(reply: HostReply) -> Vec<u8> {
    let payload = reply.bytes.unwrap_or_default();
    let length = u32::try_from(reply.reply.len()).expect("bounded wire replies fit a u32 length");
    let mut frame = Vec::with_capacity(4 + reply.reply.len() + payload.len());
    frame.extend_from_slice(&length.to_le_bytes());
    frame.extend_from_slice(&reply.reply);
    frame.extend_from_slice(&payload);
    frame
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};

    fn frame(kind: &str, generation: u64, request: &[u8], payload: &[u8]) -> Vec<u8> {
        let header =
            serde_json::to_vec(&json!({ "kind": kind, "generation": generation })).unwrap();
        let mut frame = Vec::new();
        frame.extend_from_slice(&u32::try_from(header.len()).unwrap().to_le_bytes());
        frame.extend_from_slice(&header);
        frame.extend_from_slice(&u32::try_from(request.len()).unwrap().to_le_bytes());
        frame.extend_from_slice(request);
        frame.extend_from_slice(payload);
        frame
    }

    fn reply(frame: &[u8]) -> (Value, Vec<u8>) {
        let length = u32::from_le_bytes(frame[..4].try_into().unwrap()) as usize;
        (
            serde_json::from_slice(&frame[4..4 + length]).unwrap(),
            frame[4 + length..].to_vec(),
        )
    }

    const OCCURRENCE: &[u8] = b"00000000-0000-4000-8000-000000000701";

    #[test]
    fn a_new_generation_fences_older_frames_and_destroys_resident_work() {
        let channel = RuntimeChannel::default();
        let first = channel.attach();
        let tracker =
            br#"{"type":"new_tracker","occurrence_id":"00000000-0000-4000-8000-000000000701"}"#;
        let (opened, _) = reply(
            &channel
                .dispatch(&frame("command", first, tracker, &[]))
                .unwrap(),
        );
        assert_eq!(opened["status"], "ok");

        let second = channel.attach();
        assert_ne!(first, second);
        assert_eq!(
            channel.dispatch(&frame("observe_occurrence", first, &[], &[])),
            Err(ChannelError::StaleGeneration)
        );
        let (observed, _) = reply(
            &channel
                .dispatch(&frame("observe_occurrence", second, &[], &[]))
                .unwrap(),
        );
        assert_eq!(observed["error"]["code"], "no_project_open");
    }

    #[test]
    fn exports_return_their_bytes_after_the_reply() {
        let channel = RuntimeChannel::default();
        let generation = channel.attach();
        let tracker =
            br#"{"type":"new_tracker","occurrence_id":"00000000-0000-4000-8000-000000000701"}"#;
        let (opened, _) = reply(
            &channel
                .dispatch(&frame("command", generation, tracker, &[]))
                .unwrap(),
        );
        let revision = opened["response"]["payload"]["bootstrap"]["revision"]
            .as_str()
            .unwrap();
        let (receipt, bytes) = reply(
            &channel
                .dispatch(&frame(
                    "export_project",
                    generation,
                    revision.as_bytes(),
                    &[],
                ))
                .unwrap(),
        );
        assert_eq!(receipt["response"]["type"], "project_exported");
        assert_eq!(
            receipt["response"]["payload"]["byte_length"],
            json!(bytes.len())
        );

        let (closed, _) = reply(
            &channel
                .dispatch(&frame("close_project", generation, &[], &[]))
                .unwrap(),
        );
        assert_eq!(closed, json!({ "status": "closed" }));
        let (reopened, _) = reply(
            &channel
                .dispatch(&frame("open_project", generation, OCCURRENCE, &bytes))
                .unwrap(),
        );
        assert_eq!(reopened["status"], "ok", "{reopened}");
    }

    #[test]
    fn a_sealed_channel_runs_nothing() {
        let channel = RuntimeChannel::default();
        let generation = channel.attach();
        channel.seal();
        let tracker =
            br#"{"type":"new_tracker","occurrence_id":"00000000-0000-4000-8000-000000000701"}"#;
        assert_eq!(
            channel.dispatch(&frame("command", generation, tracker, &[])),
            Err(ChannelError::Sealed)
        );
    }

    #[test]
    fn a_held_operation_waits_and_makes_a_clean_report_stale() {
        use std::sync::Arc;
        let channel = Arc::new(RuntimeChannel::default());
        let generation = channel.attach();
        channel.hold();
        let waiting = {
            let channel = Arc::clone(&channel);
            std::thread::spawn(move || {
                channel.dispatch(&frame("observe_occurrence", generation, &[], &[]))
            })
        };
        while lock_gate(&channel.gate).waiting == 0 {
            std::thread::yield_now();
        }
        assert!(
            !channel.seal_if_idle(),
            "an operation arrived after the check"
        );
        channel.release();
        let (observed, _) = reply(&waiting.join().unwrap().unwrap());
        assert_eq!(observed["error"]["code"], "no_project_open");
        channel.hold();
        assert!(channel.seal_if_idle(), "nothing is waiting now");
        assert_eq!(
            channel.dispatch(&frame("observe_occurrence", generation, &[], &[])),
            Err(ChannelError::Sealed)
        );
        assert_eq!(
            channel.attach(),
            generation + 1,
            "a reloaded page reopens the gate"
        );
        assert!(
            channel
                .dispatch(&frame("observe_occurrence", generation + 1, &[], &[]))
                .is_ok()
        );
    }

    #[test]
    fn malformed_frames_run_nothing() {
        let channel = RuntimeChannel::default();
        let generation = channel.attach();
        assert_eq!(
            channel.dispatch(&[1, 0]),
            Err(ChannelError::Frame("truncated"))
        );
        assert_eq!(
            channel.dispatch(&frame("teleport", generation, &[], &[])),
            Err(ChannelError::Frame("unknown operation kind"))
        );
        let mut oversized_header = frame("command", generation, &[], &[]);
        oversized_header[..4].copy_from_slice(&u32::MAX.to_le_bytes());
        assert_eq!(
            channel.dispatch(&oversized_header),
            Err(ChannelError::Frame("section exceeds its limit"))
        );
        let extra = br#"{"kind":"command","generation":1,"extra":true}"#;
        let mut unknown_field = Vec::new();
        unknown_field.extend_from_slice(&u32::try_from(extra.len()).unwrap().to_le_bytes());
        unknown_field.extend_from_slice(extra);
        unknown_field.extend_from_slice(&0_u32.to_le_bytes());
        assert_eq!(
            channel.dispatch(&unknown_field),
            Err(ChannelError::Frame("invalid header"))
        );
        let (observed, _) = reply(
            &channel
                .dispatch(&frame("observe_occurrence", generation, &[], &[]))
                .unwrap(),
        );
        assert_eq!(observed["error"]["code"], "no_project_open");
    }
}

//! Test harness: the desktop host's runtime channel over stdio, so the Sheet's
//! TypeScript channel can be checked against the native runtime without a
//! window. Requests: `[u8 op][u32 len][bytes]` (op 0 attach, 1 dispatch).
//! Replies: `[u8 status][u32 len][bytes]` (status 0 ok, 1 channel error).

use std::io::{Read, Write};

use tachiko_sheet_desktop::RuntimeChannel;

fn main() -> std::io::Result<()> {
    let channel = RuntimeChannel::default();
    let mut input = std::io::stdin().lock();
    let mut output = std::io::stdout().lock();
    loop {
        let mut head = [0_u8; 5];
        if input.read_exact(&mut head).is_err() {
            return Ok(());
        }
        let length = u32::from_le_bytes([head[1], head[2], head[3], head[4]]) as usize;
        let mut body = vec![0_u8; length];
        input.read_exact(&mut body)?;
        let (status, reply) = match head[0] {
            0 => (0_u8, channel.attach().to_le_bytes().to_vec()),
            _ => match channel.dispatch(&body) {
                Ok(reply) => (0, reply),
                Err(error) => (1, error.to_string().into_bytes()),
            },
        };
        output.write_all(&[status])?;
        output.write_all(&u32::try_from(reply.len()).expect("bounded reply").to_le_bytes())?;
        output.write_all(&reply)?;
        output.flush()?;
    }
}

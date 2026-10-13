// Test-only independent inspection/mutation of Work's store-only ZIP32 output.
// Production never imports this module or decodes a work-file container.
import assert from "node:assert/strict";
import { crc32 } from "node:zlib";

export function archiveEntries(bytes) {
  const entries = [];
  let offset = 0;
  while (bytes.readUInt32LE(offset) === 0x04034b50) {
    const size = bytes.readUInt32LE(offset + 18);
    const nameLength = bytes.readUInt16LE(offset + 26);
    const extraLength = bytes.readUInt16LE(offset + 28);
    assert.equal(bytes.readUInt16LE(offset + 8), 0, "Work emits uncompressed members");
    const name = bytes.subarray(offset + 30, offset + 30 + nameLength).toString("utf8");
    const begin = offset + 30 + nameLength + extraLength;
    const body = bytes.subarray(begin, begin + size);
    assert.equal(body.length, size);
    assert.equal(crc32(body), bytes.readUInt32LE(offset + 14), `${name}: CRC matches downloaded bytes`);
    entries.push({ name, body });
    offset = begin + size;
  }
  assert.equal(bytes.readUInt32LE(offset), 0x02014b50);
  assert.equal(entries.length, 20);
  assert.equal(entries[0].name, "package.json");
  assert.equal(new Set(entries.map(entry => entry.name)).size, 20);
  return entries;
}

// A developmental-profile refusal with valid CRCs/ZIP framing, rather than a
// corrupt-byte refusal mislabelled as profile coverage. Integrity is verified
// by Work; the test deliberately changes only the profile manifest.
export function developmentalArchive(bytes) {
  const entries = archiveEntries(bytes).map(entry => ({ ...entry }));
  const manifest = JSON.parse(entries[0].body);
  manifest.payload_format_version = 1;
  entries[0].body = Buffer.from(JSON.stringify(manifest));
  const local = [], central = [];
  let offset = 0;
  for (const { name, body } of entries) {
    const nameBytes = Buffer.from(name);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt32LE(crc32(body), 14);
    header.writeUInt32LE(body.length, 18);
    header.writeUInt32LE(body.length, 22);
    header.writeUInt16LE(nameBytes.length, 26);
    local.push(header, nameBytes, body);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt32LE(crc32(body), 16);
    record.writeUInt32LE(body.length, 20);
    record.writeUInt32LE(body.length, 24);
    record.writeUInt16LE(nameBytes.length, 28);
    record.writeUInt32LE(offset, 42);
    central.push(record, nameBytes);
    offset += header.length + nameBytes.length + body.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

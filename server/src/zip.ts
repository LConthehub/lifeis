/** A zip file from a list of text files: enough of the format for folders of recipes, and nothing more. */
import { crc32, deflateRawSync } from 'node:zlib';

export function zip(files: { path: string; text: string }[], at: Date = new Date()): Buffer {
  const time = (at.getHours() << 11) | (at.getMinutes() << 5) | (at.getSeconds() >> 1);
  const date = ((Math.max(at.getFullYear(), 1980) - 1980) << 9) | ((at.getMonth() + 1) << 5) | at.getDate();
  const parts: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.path, 'utf8');
    const plain = Buffer.from(file.text, 'utf8');
    const packed = deflateRawSync(plain);
    // What both headers share: version needed 2.0, names in UTF-8 (bit 11), deflate, then time, sums and sizes.
    const shared = Buffer.alloc(26);
    shared.writeUInt16LE(20, 0);
    shared.writeUInt16LE(0x0800, 2);
    shared.writeUInt16LE(8, 4);
    shared.writeUInt16LE(time, 6);
    shared.writeUInt16LE(date, 8);
    shared.writeUInt32LE(crc32(plain), 10);
    shared.writeUInt32LE(packed.length, 14);
    shared.writeUInt32LE(plain.length, 18);
    shared.writeUInt16LE(name.length, 22);
    shared.writeUInt16LE(0, 24);

    const local = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), shared, name, packed]);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4); // made by: version 2.0
    shared.copy(entry, 6);
    entry.writeUInt32LE(offset, 42); // comment length, disk, and attributes in between stay 0
    directory.push(entry, name);
    parts.push(local);
    offset += local.length;
  }
  const directoryBytes = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directoryBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, directoryBytes, end]);
}

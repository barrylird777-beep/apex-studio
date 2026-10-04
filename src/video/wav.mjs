export const BYTES_PER_SAMPLE = 2;

export function pcmToWav(pcm, sampleRate = 24000) {
  if (!Buffer.isBuffer(pcm)) throw new TypeError('pcm must be a Buffer');
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) throw new Error('sampleRate must be a positive integer');
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * BYTES_PER_SAMPLE, 28);
  header.writeUInt16LE(BYTES_PER_SAMPLE, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export function parseWav(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('invalid WAV');
  }
  const audioFormat = buffer.readUInt16LE(20);
  const channels = buffer.readUInt16LE(22);
  const sampleRate = buffer.readUInt32LE(24);
  const bitsPerSample = buffer.readUInt16LE(34);
  if (audioFormat !== 1 || channels !== 1 || bitsPerSample !== 16) {
    throw new Error('unsupported WAV: expected 16-bit mono PCM');
  }
  let offset = 12;
  let dataStart = -1;
  let dataLength = 0;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    if (id === 'data') {
      dataStart = offset + 8;
      dataLength = Math.min(size, buffer.length - dataStart);
      break;
    }
    offset += 8 + size + (size & 1);
  }
  if (dataStart < 0) throw new Error('WAV has no data chunk');
  return { pcm: buffer.subarray(dataStart, dataStart + dataLength), sampleRate };
}

export const durationOfPcm = (pcm, sampleRate = 24000) =>
  pcm.length / (BYTES_PER_SAMPLE * sampleRate);

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RtmpChunkDecoder,
  RtmpSessionMultiplexer,
  buildRtmpHandshake,
  encodeChunkedMessage,
  parseRtmpUrl
} from '../src/core/real-zero-stop-proxy.mjs';

test('RTMP URL parser separates app and stream', () => {
  assert.deepEqual(
    parseRtmpUrl('rtmp://example.test:1935/live/apex'),
    { host: 'example.test', port: 1935, app: 'live', stream: 'apex' }
  );
});

test('RTMP handshake emits C0 plus 1536-byte C1', () => {
  const handshake = buildRtmpHandshake();
  assert.equal(handshake.length, 1537);
  assert.equal(handshake[0], 3);
});

test('RTMP chunk muxer and demuxer preserve logical message payload', () => {
  const payload = Buffer.from('apex-zero-stop');
  const encoded = encodeChunkedMessage({
    csid: 6,
    timestamp: 1234,
    type: 9,
    streamId: 1,
    payload,
    chunkSize: 4
  });

  const decoder = new RtmpChunkDecoder({ chunkSize: 4 });
  let message = null;
  decoder.on('message', value => { message = value; });

  decoder.push(encoded.subarray(0, 3));
  assert.equal(message, null);
  decoder.push(encoded.subarray(3));

  assert.ok(message);
  assert.equal(message.type, 9);
  assert.equal(message.timestamp, 1234);
  assert.equal(message.streamId, 1);
  assert.deepEqual(message.payload, payload);
});

test('session multiplexer exposes persistent downstream state', () => {
  const relay = new RtmpSessionMultiplexer({
    destination: 'rtmp://127.0.0.1:1935/live/apex',
    fallbackMedia: [{
      type: 9,
      payload: Buffer.from([0x17, 0x01]),
      durationMs: 40
    }]
  });

  const status = relay.status();
  assert.equal(status.multiplexer, true);
  assert.equal(status.persistentDownstream, true);
  assert.equal(status.protocol, 'rtmp');
  assert.equal(status.fallbackConfigured, true);

  relay.stop();
});

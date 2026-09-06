const http = require('http');
const request = require('supertest');
const ioClient = require('socket.io-client');
const { app, server, rooms, failedJoinTracker, destroyRoom } = require('../server');

let listener;
let port;
let socketUrl;

beforeAll((done) => {
  listener = server.listen(0, () => {
    port = listener.address().port;
    socketUrl = `http://localhost:${port}`;
    done();
  });
});

afterAll((done) => {
  if (listener) {
    listener.close(done);
  } else {
    done();
  }
});

afterEach(() => {
  failedJoinTracker.clear();
  // Clear all rooms
  for (const [code] of rooms.entries()) {
    destroyRoom(code, 'test-cleanup');
  }
});

describe('DropBridge Security & Lifecyle Unit Tests', () => {

  test('1. HTTP API generates a 6-character room code', async () => {
    const res = await request(app).post('/api/create-room').expect(200);
    expect(res.body).toHaveProperty('roomCode');
    expect(res.body.roomCode).toMatch(/^[2-9A-HJ-NP-Z]{6}$/);
    expect(rooms.has(res.body.roomCode)).toBe(true);
  });

  test('2. Zero-Knowledge Assert: Server stores ONLY ciphertext in memory', (done) => {
    request(app)
      .post('/api/create-room')
      .end((err, res) => {
        if (err) return done(err);
        const roomCode = res.body.roomCode;
        const client = ioClient(socketUrl, { autoConnect: true });

        const secretText = 'CONFIDENTIAL_KEY_12345_SECRET_DATA';
        // Simulated browser E2EE ciphertext (AES-GCM encrypted base64)
        const fakeCiphertext = 'E2EE_CIPHERTEXT_b3BlbnNzaC1rZXktdjEAAAAEbm9uZQ==';
        const fakeIv = 'bXlSYW5kb21JVjEyM0E=';

        client.emit('join_room', { roomCode }, (joinRes) => {
          expect(joinRes.success).toBe(true);

          client.emit(
            'drop_item',
            {
              roomCode,
              encryptedPayload: {
                ciphertext: fakeCiphertext,
                iv: fakeIv,
                mimeType: 'text/plain',
                itemType: 'text',
                size: secretText.length
              }
            },
            (dropRes) => {
              expect(dropRes.success).toBe(true);

              const storedRoom = rooms.get(roomCode);
              expect(storedRoom).toBeDefined();
              expect(storedRoom.items.length).toBe(1);

              const item = storedRoom.items[0];
              // Ensure server memory contains ciphertext and NEVER plaintext
              expect(item.ciphertext).toBe(fakeCiphertext);
              expect(JSON.stringify(storedRoom.items)).not.toContain(secretText);

              client.disconnect();
              done();
            }
          );
        });
      });
  });

  test('3. Brute-Force Join Lockout: Blocks IP after 5 failed code attempts', (done) => {
    const client = ioClient(socketUrl, { autoConnect: true });

    let failedAttempts = 0;
    const attemptInvalidJoin = () => {
      client.emit('join_room', { roomCode: 'INVALID' }, (res) => {
        failedAttempts++;
        if (failedAttempts < 5) {
          expect(res.error).toBe('Invalid or expired room code.');
          attemptInvalidJoin();
        } else if (failedAttempts === 5) {
          expect(res.error).toBe('Invalid or expired room code.');
          // 6th attempt should trigger IP block rate limit!
          client.emit('join_room', { roomCode: 'INVALID' }, (res6) => {
            expect(res6.success).toBe(false);
            expect(res6.error).toContain('Too many invalid code attempts');
            client.disconnect();
            done();
          });
        }
      });
    };

    attemptInvalidJoin();
  });

  test('4. 10-Second Grace Period: Disconnect does NOT nuke room immediately', (done) => {
    request(app)
      .post('/api/create-room')
      .end((err, res) => {
        if (err) return done(err);
        const roomCode = res.body.roomCode;
        const client = ioClient(socketUrl, { autoConnect: true });

        client.emit('join_room', { roomCode }, (joinRes) => {
          expect(joinRes.success).toBe(true);
          expect(rooms.has(roomCode)).toBe(true);

          // Disconnect client
          client.disconnect();

          // Check after 200ms: Room should still exist in grace period!
          setTimeout(() => {
            const roomInGrace = rooms.get(roomCode);
            expect(roomInGrace).toBeDefined();
            expect(roomInGrace.graceTimer).not.toBeNull();

            // Clean up timer manually for test
            destroyRoom(roomCode, 'test end');
            done();
          }, 200);
        });
      });
  });
});

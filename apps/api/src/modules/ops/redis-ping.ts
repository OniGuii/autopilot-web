import * as net from 'net';

/**
 * Lightweight Redis PING without adding a Redis client dependency.
 */
export async function pingRedis(options: {
  host: string;
  port: number;
  password?: string;
  timeoutMs?: number;
}): Promise<boolean> {
  const timeoutMs = options.timeoutMs ?? 2000;

  return new Promise((resolve) => {
    const socket = net.createConnection({
      host: options.host,
      port: options.port,
    });

    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok);
    };

    const timer = setTimeout(() => finish(false), timeoutMs);

    socket.once('error', () => {
      clearTimeout(timer);
      finish(false);
    });

    socket.once('connect', () => {
      try {
        if (options.password) {
          const pwd = options.password;
          socket.write(
            `*2\r\n$4\r\nAUTH\r\n$${Buffer.byteLength(pwd)}\r\n${pwd}\r\n`,
          );
        }
        socket.write('*1\r\n$4\r\nPING\r\n');
      } catch {
        clearTimeout(timer);
        finish(false);
      }
    });

    socket.on('data', (buf) => {
      const text = buf.toString('utf8');
      if (text.includes('+PONG') || text.includes('+OK')) {
        clearTimeout(timer);
        finish(true);
      }
      if (text.includes('-ERR') || text.includes('-WRONGPASS')) {
        clearTimeout(timer);
        finish(false);
      }
    });
  });
}

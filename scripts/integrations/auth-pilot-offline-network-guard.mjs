// Used only by the synthetic startup rehearsal, never by the real pilot.
import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
const deny = () => { throw new Error('SYNTHETIC_STARTUP_NETWORK_DENIED'); };
globalThis.fetch = deny;
net.connect = deny;
net.createConnection = deny;
net.Socket.prototype.connect = deny;
net.Server.prototype.listen = deny;
tls.connect = deny;
http.request = deny;
http.get = deny;
https.request = deny;
https.get = deny;
syncBuiltinESMExports();

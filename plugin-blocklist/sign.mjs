#!/usr/bin/env node
import { access, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { webcrypto } from 'node:crypto';

const { subtle } = webcrypto;
const scriptDir = dirname(fileURLToPath(import.meta.url));
const defaultInput = resolve(scriptDir, 'blocklist.json');
const defaultOutput = resolve(scriptDir, 'blocklist.json.sig');
const defaultPrivateKey = resolve(scriptDir, 'private-key.jwk');
const defaultPublicKey = resolve(scriptDir, 'public-key.jwk');
const defaultAppPublicKey = resolve(scriptDir, '../app/src/config/pluginBlocklistPublicKey.json');

const usage = () => {
  console.log(`Usage:
  node plugin-blocklist/sign.mjs generate-key [--force] [--private-key <path>] [--public-key <path>] [--app-public-key <path>]
  node plugin-blocklist/sign.mjs sign [--input <path>] [--output <path>] [--private-key <path>]
  node plugin-blocklist/sign.mjs verify [--input <path>] [--signature <path>] [--public-key <path>]

Environment:
  BLOCKLIST_PRIVATE_JWK  Optional private JWK JSON. If set, sign uses it instead of --private-key.
`);
};

const command = process.argv[2] ?? 'help';
const args = process.argv.slice(3);

const optionValue = (name, fallback) => {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${name} requires a value.`);
  }
  return resolve(process.cwd(), value);
};

const hasOption = (name) => args.includes(name);

const assertCanWriteKey = async (path, force) => {
  if (force) return;
  try {
    await access(path);
    throw new Error(`${path} already exists. Use --force to overwrite it.`);
  } catch (error) {
    if (error && error.code === 'ENOENT') return;
    throw error;
  }
};

const base64Url = (bytes) => Buffer.from(bytes)
  .toString('base64')
  .replaceAll('+', '-')
  .replaceAll('/', '_')
  .replace(/=+$/u, '');

const normalizeBase64 = (value) => {
  const normalized = value.trim().replaceAll('-', '+').replaceAll('_', '/');
  return normalized.padEnd(normalized.length + ((4 - normalized.length % 4) % 4), '=');
};

const decodeBase64 = (value) => Uint8Array.from(Buffer.from(normalizeBase64(value), 'base64'));

const signatureFromText = (text) => {
  const trimmed = text.trim();
  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed.signature === 'string') return parsed.signature;
  } catch {
    // Plain signature files are supported too.
  }
  return trimmed;
};

const generateKey = async () => {
  const privateKeyPath = optionValue('--private-key', defaultPrivateKey);
  const publicKeyPath = optionValue('--public-key', defaultPublicKey);
  const appPublicKeyPath = optionValue('--app-public-key', defaultAppPublicKey);
  const force = hasOption('--force');

  await Promise.all([
    assertCanWriteKey(privateKeyPath, force),
    assertCanWriteKey(publicKeyPath, force),
    assertCanWriteKey(appPublicKeyPath, force),
  ]);

  const keyPair = await subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  );
  const privateKeyJwk = await subtle.exportKey('jwk', keyPair.privateKey);
  const publicKeyJwk = await subtle.exportKey('jwk', keyPair.publicKey);

  await Promise.all([
    writeFile(privateKeyPath, `${JSON.stringify(privateKeyJwk, null, 2)}\n`, { mode: 0o600 }),
    writeFile(publicKeyPath, `${JSON.stringify(publicKeyJwk, null, 2)}\n`),
    writeFile(appPublicKeyPath, `${JSON.stringify(publicKeyJwk, null, 2)}\n`),
  ]);

  console.log(`Wrote private key: ${privateKeyPath}`);
  console.log(`Wrote public key: ${publicKeyPath}`);
  console.log(`Wrote app trusted public key: ${appPublicKeyPath}`);
  console.log('Keep the private key out of Git, logs, screenshots, and build artifacts.');
};

const sign = async () => {
  const input = optionValue('--input', defaultInput);
  const output = optionValue('--output', defaultOutput);
  const privateKeyPath = optionValue('--private-key', defaultPrivateKey);
  const privateKeyText = process.env.BLOCKLIST_PRIVATE_JWK ?? await readFile(privateKeyPath, 'utf8');

  const payload = await readFile(input);
  JSON.parse(payload.toString('utf8'));

  const privateKey = await subtle.importKey(
    'jwk',
    JSON.parse(privateKeyText),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const signature = await subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    payload,
  );

  await writeFile(output, `${JSON.stringify({
    algorithm: 'ECDSA-P256-SHA256',
    signature: base64Url(new Uint8Array(signature)),
  }, null, 2)}\n`);
  console.log(`Signed ${input}`);
  console.log(`Wrote ${output}`);
};

const verify = async () => {
  const input = optionValue('--input', defaultInput);
  const signaturePath = optionValue('--signature', defaultOutput);
  const publicKeyPath = optionValue('--public-key', defaultPublicKey);
  const [payload, signatureText, publicKeyText] = await Promise.all([
    readFile(input),
    readFile(signaturePath, 'utf8'),
    readFile(publicKeyPath, 'utf8'),
  ]);

  JSON.parse(payload.toString('utf8'));

  const publicKey = await subtle.importKey(
    'jwk',
    JSON.parse(publicKeyText),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  );
  const ok = await subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    publicKey,
    decodeBase64(signatureFromText(signatureText)),
    payload,
  );

  if (!ok) {
    throw new Error('Signature verification failed.');
  }

  console.log(`Verified ${input}`);
};

try {
  if (command === 'generate-key') {
    await generateKey();
  } else if (command === 'sign') {
    await sign();
  } else if (command === 'verify') {
    await verify();
  } else {
    usage();
    process.exit(command === 'help' ? 0 : 1);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

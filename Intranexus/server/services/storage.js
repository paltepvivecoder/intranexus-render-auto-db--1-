import { randomUUID } from 'node:crypto';

const MAX_UPLOAD_BYTES = Math.min(Number(process.env.MAX_UPLOAD_BYTES) || 8 * 1024 * 1024, 12 * 1024 * 1024);
const allowedTypes = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
]);

export function validateImageUpload(contentType, size) {
  if (!allowedTypes.has(contentType)) {
    const error = new Error('Suportado lamang ang JPEG, PNG at WebP na larawan.');
    error.status = 400;
    error.code = 'unsupported_image_type';
    throw error;
  }
  if (!Number.isSafeInteger(size) || size < 1 || size > MAX_UPLOAD_BYTES) {
    const error = new Error(`Hindi wasto ang laki ng larawan. Maximum na pinapayagan: ${MAX_UPLOAD_BYTES} bytes.`);
    error.status = 400;
    error.code = 'invalid_upload_size';
    throw error;
  }
  return { contentType, size, maxSize: MAX_UPLOAD_BYTES, extension: allowedTypes.get(contentType) };
}

export async function createPresignedUpload(userId, contentType) {
  const apiBase = process.env.MANUS_API_URL;
  const apiKey = process.env.MANUS_API_KEY;
  if (!apiBase || !apiKey) {
    const error = new Error('Secure image storage is not available yet.');
    error.status = 503;
    error.code = 'storage_not_configured';
    throw error;
  }
  const extension = allowedTypes.get(contentType);
  if (!extension) {
    const error = new Error('Suportado lamang ang JPEG, PNG at WebP na larawan.');
    error.status = 400;
    error.code = 'unsupported_image_type';
    throw error;
  }
  const photoKey = `intranexus/nexsocial/${userId}/${randomUUID()}.${extension}`;
  const endpoint = new URL('/v1/storage/presign/put', apiBase);
  endpoint.searchParams.set('path', photoKey);
  const response = await fetch(endpoint, {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || typeof body.url !== 'string' || !body.url.startsWith('https://')) {
    const error = new Error('Hindi makakuha ng secure upload address mula sa storage service.');
    error.status = 503;
    error.code = 'storage_presign_failed';
    throw error;
  }
  return { photoKey, uploadUrl: body.url, contentType };
}

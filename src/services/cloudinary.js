const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
});

/**
 * Genera una firma de subida para que el navegador suba directo a Cloudinary
 * dentro de la carpeta de la empresa/sitio, sin exponer un preset publico.
 */
function signUpload({ folder, publicId, resourceType }) {
  const timestamp = Math.round(Date.now() / 1000);
  const paramsToSign = { folder, timestamp };
  if (publicId) paramsToSign.public_id = publicId;

  const signature = cloudinary.utils.api_sign_request(
    paramsToSign,
    process.env.CLOUDINARY_API_SECRET
  );

  return {
    timestamp,
    signature,
    apiKey: process.env.CLOUDINARY_API_KEY,
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    folder,
    publicId,
    resourceType: resourceType || 'auto'
  };
}

async function destroyAsset(publicId, resourceType) {
  return cloudinary.uploader.destroy(publicId, { resource_type: resourceType || 'image' });
}

module.exports = { cloudinary, signUpload, destroyAsset };

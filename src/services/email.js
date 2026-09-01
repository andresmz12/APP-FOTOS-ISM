const { Resend } = require('resend');

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

async function sendJobNotification({ to, companyName, siteName, employeeName, jobType, media, appUrl }) {
  if (!resend || !to) return { skipped: true };

  const thumbs = media
    .slice(0, 8)
    .map((m) => {
      if (m.resource_type === 'video') {
        return `<div style="display:inline-block;margin:4px;padding:8px;border:1px solid #ddd;border-radius:8px;font:12px sans-serif;">Video adjunto</div>`;
      }
      return `<img src="${m.secure_url}" width="140" style="margin:4px;border-radius:8px;object-fit:cover;" />`;
    })
    .join('');

  const html = `
    <div style="font-family: sans-serif; max-width: 560px;">
      <h2>Nuevas fotos subidas - ${companyName}</h2>
      <p><strong>Sitio:</strong> ${siteName}</p>
      <p><strong>Trabajador:</strong> ${employeeName || 'No especificado'}</p>
      <p><strong>Tipo de trabajo:</strong> ${jobType}</p>
      <p><strong>Total de archivos:</strong> ${media.length}</p>
      <div>${thumbs}</div>
      <p><a href="${appUrl}">Ver galeria completa</a></p>
    </div>
  `;

  return resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL || 'FieldProof <notificaciones@fieldproof.app>',
    to,
    subject: `${companyName}: nuevas fotos en ${siteName}`,
    html
  });
}

module.exports = { sendJobNotification };

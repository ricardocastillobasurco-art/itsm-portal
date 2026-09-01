const express    = require('express');
const router     = express.Router();
const nodemailer = require('nodemailer');

router.post('/send-invite', async (req, res) => {
  const { subject, recipients, extraMsg, imageBase64 } = req.body;

  if (!subject || !recipients?.length || !imageBase64) {
    return res.status(400).json({ success: false, error: 'Faltan campos requeridos' });
  }

  const validRecipients = recipients.filter(r => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r));
  if (!validRecipients.length) {
    return res.status(400).json({ success: false, error: 'No hay correos válidos' });
  }

  const html = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${subject}</title></head>
<body style="margin:0;padding:0;background:#f0f4f8;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f4f8;padding:40px 0;">
  <tr><td align="center">
    <table width="560" cellpadding="0" cellspacing="0" style="border-radius:20px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,.15);background:#ffffff;">
      <tr><td style="padding:0;">
        <img src="cid:card_image" alt="${subject}"
             style="width:100%;display:block;border-radius:20px 20px 0 0;" />
      </td></tr>
      ${extraMsg ? `<tr><td style="padding:24px 32px 8px;">
        <p style="font-size:14px;color:#475569;line-height:1.7;margin:0;">${extraMsg.replace(/\n/g,'<br>')}</p>
      </td></tr>` : ''}
      <tr><td style="padding:20px 32px 28px;border-top:1px solid #e2e8f0;text-align:center;">
        <p style="font-size:11px;color:#94a3b8;margin:0;">Este mensaje fue enviado desde el Service Desk TI</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;

  try {
    const transporter = nodemailer.createTransport({
      host:   process.env.SMTP_HOST1  || process.env.SMTP_HOST  || 'smtp.office365.com',
      port:   parseInt(process.env.SMTP_PORT1  || process.env.SMTP_PORT  || '587'),
      secure: (process.env.SMTP_SECURE1 || process.env.SMTP_SECURE) === 'true',
      auth: {
        user: process.env.SMTP_USER1 || process.env.SMTP_USER,
        pass: process.env.SMTP_PASS1 || process.env.SMTP_PASS,
      },
      tls: { rejectUnauthorized: false },
    });

    await transporter.sendMail({
      from:    `"${process.env.MAIL_FROM_NAME1 || 'Equipo TI'}" <${process.env.SMTP_USER1 || process.env.SMTP_USER}>`,
      to:      validRecipients.join(', '),
      subject,
      html,
      attachments: [{
        filename:    'tarjeta.png',
        content:     imageBase64,
        encoding:    'base64',
        cid:         'card_image',
        contentType: 'image/png',
      }],
    });

    res.json({ success: true, sent: validRecipients.length });
  } catch (err) {
    console.error('❌ events/send-invite:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;

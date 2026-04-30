export default function handler(request, response) {
  const config = {
    supabaseUrl: process.env.SANPRO_SUPABASE_URL || '',
    supabaseAnonKey: process.env.SANPRO_SUPABASE_ANON_KEY || '',
    developerWhatsApp: process.env.SANPRO_DEVELOPER_WHATSAPP || '18497851259',
    paypalUrl: process.env.SANPRO_PAYPAL_URL || 'https://www.paypal.me/sandypavon0329',
    bankAccount: process.env.SANPRO_BANK_ACCOUNT || '9601016551'
  };

  response.setHeader('content-type', 'application/javascript; charset=utf-8');
  response.setHeader('cache-control', 'no-store');
  response.status(200).send(`window.SANPRO_CONFIG = ${JSON.stringify(config)};`);
}

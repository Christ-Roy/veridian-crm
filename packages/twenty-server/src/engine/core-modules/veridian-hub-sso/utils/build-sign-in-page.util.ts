const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

// CONTRAT-HUB §6bis.8.0 points 2 to 4: shown instead of a silent sign-in.
export const buildSignInPage = (bounceUrl: string) => `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connexion</title>
<style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif;background:#fafafa;color:#333}
main{text-align:center;padding:16px}
a{display:inline-block;margin-top:16px;padding:10px 20px;border-radius:8px;background:#1a56db;color:#fff;text-decoration:none}
</style>
</head>
<body>
<main>
<h1>Connexion</h1>
<p>Connectez-vous avec votre compte Veridian.</p>
<a href="${escapeHtml(bounceUrl)}">Continuer</a>
</main>
</body>
</html>
`;

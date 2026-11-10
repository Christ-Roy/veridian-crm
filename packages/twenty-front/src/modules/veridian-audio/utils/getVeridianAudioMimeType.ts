// Formats que le navigateur sait lire : enregistrements d'appels (Ogg Opus de JemRec), notes vocales.
// L'AMR des vieux MMS n'est lu par aucun navigateur : il garde l'aperçu « non disponible » et le téléchargement.
const VERIDIAN_AUDIO_MIME_TYPES: Record<string, string> = {
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  wav: 'audio/wav',
  weba: 'audio/webm',
};

export const getVeridianAudioMimeType = (
  fileExtension: string,
): string | undefined =>
  VERIDIAN_AUDIO_MIME_TYPES[fileExtension.toLowerCase().replace('.', '')];

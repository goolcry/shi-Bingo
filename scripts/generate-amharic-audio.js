const fs = require('node:fs/promises');
const path = require('node:path');

const outputDir = path.join(__dirname, '..', 'public', 'audio', 'amharic');
const amharicWords = {
  1: 'አንድ', 2: 'ሁለት', 3: 'ሦስት', 4: 'አራት', 5: 'አምስት',
  6: 'ስድስት', 7: 'ሰባት', 8: 'ስምንት', 9: 'ዘጠኝ', 10: 'አስር',
  11: 'አስራ አንድ', 12: 'አስራ ሁለት', 13: 'አስራ ሦስት', 14: 'አስራ አራት', 15: 'አስራ አምስት',
  16: 'አስራ ስድስት', 17: 'አስራ ሰባት', 18: 'አስራ ስምንት', 19: 'አስራ ዘጠኝ', 20: 'ሃያ',
  21: 'ሃያ አንድ', 22: 'ሃያ ሁለት', 23: 'ሃያ ሦስት', 24: 'ሃያ አራት', 25: 'ሃያ አምስት',
  26: 'ሃያ ስድስት', 27: 'ሃያ ሰባት', 28: 'ሃያ ስምንት', 29: 'ሃያ ዘጠኝ', 30: 'ሠላሳ',
  31: 'ሠላሳ አንድ', 32: 'ሠላሳ ሁለት', 33: 'ሠላሳ ሦስት', 34: 'ሠላሳ አራት', 35: 'ሠላሳ አምስት',
  36: 'ሠላሳ ስድስት', 37: 'ሠላሳ ሰባት', 38: 'ሠላሳ ስምንት', 39: 'ሠላሳ ዘጠኝ', 40: 'አርባ',
  41: 'አርባ አንድ', 42: 'አርባ ሁለት', 43: 'አርባ ሦስት', 44: 'አርባ አራት', 45: 'አርባ አምስት',
  46: 'አርባ ስድስት', 47: 'አርባ ሰባት', 48: 'አርባ ስምንት', 49: 'አርባ ዘጠኝ', 50: 'ሃምሳ',
  51: 'ሃምሳ አንድ', 52: 'ሃምሳ ሁለት', 53: 'ሃምሳ ሦስት', 54: 'ሃምሳ አራት', 55: 'ሃምሳ አምስት',
  56: 'ሃምሳ ስድስት', 57: 'ሃምሳ ሰባት', 58: 'ሃምሳ ስምንት', 59: 'ሃምሳ ዘጠኝ', 60: 'ስድሳ',
  61: 'ስድሳ አንድ', 62: 'ስድሳ ሁለት', 63: 'ስድሳ ሦስት', 64: 'ስድሳ አራት', 65: 'ስድሳ አምስት',
  66: 'ስድሳ ስድስት', 67: 'ስድሳ ሰባት', 68: 'ስድሳ ስምንት', 69: 'ስድሳ ዘጠኝ', 70: 'ሰባ',
  71: 'ሰባ አንድ', 72: 'ሰባ ሁለት', 73: 'ሰባ ሦስት', 74: 'ሰባ አራት', 75: 'ሰባ አምስት',
};

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function downloadNumberAudio(number, text) {
  const outputPath = path.join(outputDir, `${number}.mp3`);
  try {
    const existing = await fs.stat(outputPath);
    if (existing.size > 100) {
      console.log(`Skipping ${number}: existing audio file is ${existing.size} bytes.`);
      return;
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const url = new URL('https://translate.google.com/translate_tts');
  url.search = new URLSearchParams({
    ie: 'UTF-8',
    q: text,
    tl: 'am',
    client: 'tw-ob',
  }).toString();

  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const temporaryPath = `${outputPath}.part`;
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 ShishoBingoAudioGenerator/1.0' },
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('audio')) throw new Error(`Unexpected content type: ${contentType || 'missing'}`);
      const audio = Buffer.from(await response.arrayBuffer());
      if (audio.length <= 100) throw new Error(`Audio response too small (${audio.length} bytes)`);
      await fs.writeFile(temporaryPath, audio, { flag: 'w' });
      await fs.rename(temporaryPath, outputPath);
      console.log(`Saved ${number}.mp3 (${audio.length} bytes).`);
      return;
    } catch (error) {
      lastError = error;
      await fs.rm(temporaryPath, { force: true });
      if (attempt < 3) await delay(1000 * attempt);
    }
  }
  throw new Error(`Could not generate ${number}.mp3: ${lastError.message}`, { cause: lastError });
}

async function main() {
  await fs.mkdir(outputDir, { recursive: true });
  console.log('Generating Amharic number call audio for 1–75.');
  for (let number = 1; number <= 75; number += 1) {
    await downloadNumberAudio(number, amharicWords[number]);
    await delay(250);
  }
  console.log(`All 75 Amharic clips are available in ${outputDir}.`);
}

main().catch((error) => {
  console.error('[Amharic audio generation failed]:', error);
  process.exitCode = 1;
});

function parseArgs(argv) {
  const args = {};

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--') && !token.startsWith('-')) continue;

    // Normalize key (strip leading dashes, lowercase)
    let [rawKey, inlineValue] = token.replace(/^--?/, '').split('=');
    const key = rawKey.toLowerCase();

    // Determine value
    let value;
    if (typeof inlineValue !== 'undefined') {
      value = inlineValue;
    } else {
      const nextToken = argv[i + 1];
      if (!nextToken || nextToken.startsWith('-')) {
        value = true; // flag
      } else {
        value = nextToken;
        i++;
      }
    }

    // Strip quotes if present
    if (typeof value === 'string' && /^["'].*["']$/.test(value)) {
      value = value.slice(1, -1);
    }

    // Type coercion
    if (value === 'true') value = true;
    else if (value === 'false') value = false;
    else if (!isNaN(value) && value !== '') value = Number(value);

    args[key] = value;
  }

  return args;
}

function doPost(event) {
  const raw = event.postData && event.postData.contents;
  if (!raw || raw.length > 32000) return json_({error: 'invalid_request'});

  let request;
  try {
    request = JSON.parse(raw);
  } catch {
    return json_({error: 'invalid_request'});
  }
  if (!request || !validKey_(request.key)) return json_({error: 'unauthorized'});

  const properties = PropertiesService.getScriptProperties();
  if (request.action === 'list') {
    const saved = Object.values(properties.getProperties()).map(decode_);
    return json_({data: saved.sort((a, b) => a.created.localeCompare(b.created))});
  }
  if (request.action === 'delete' && validId_(request.id)) {
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) return json_({error: 'busy'});
    try {
      properties.deleteProperty('comment_' + request.id);
      return json_({data: true});
    } finally {
      lock.releaseLock();
    }
  }
  if (request.action !== 'save' || !validComment_(request.comment)) {
    return json_({error: 'invalid_comment'});
  }
  const comment = request.comment;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return json_({error: 'busy'});
  try {
    const id = 'comment_' + comment.id;
    const existing = properties.getProperty(id);
    if (existing) return json_({data: decode_(existing)});
    const saved = {
      id: comment.id, anchor: comment.anchor, start: comment.start, end: comment.end,
      quote: comment.quote, message: comment.message.trim(), created: new Date().toISOString(),
    };
    const encoded = JSON.stringify(saved);
    if (Utilities.newBlob(encoded).getBytes().length > 8500) return json_({error: 'too_long'});
    properties.setProperty(id, encoded);
    return json_({data: saved});
  } finally {
    lock.releaseLock();
  }
}

function validKey_(key) {
  if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(key)) return false;
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, key, Utilities.Charset.UTF_8)
    .map(byte => (byte & 255).toString(16).padStart(2, '0')).join('');
  let difference = 0;
  for (let i = 0; i < 64; i++) difference |= digest.charCodeAt(i) ^ REVIEW_KEY_HASH.charCodeAt(i);
  return difference === 0;
}

function validComment_(note) {
  return note && validId_(note.id) &&
    typeof note.anchor === 'string' && /^(p-[1-8]|book-(?:[1-9]|10|11))$/.test(note.anchor) &&
    Number.isInteger(note.start) && Number.isInteger(note.end) &&
    note.start >= 0 && note.end > note.start && note.end <= 2000 &&
    typeof note.quote === 'string' && note.quote.length === note.end - note.start &&
    typeof note.message === 'string' && note.message.trim() && note.message.length <= 4000;
}

function validId_(id) {
  return typeof id === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id);
}

function decode_(value) {
  return JSON.parse(value);
}

function json_(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

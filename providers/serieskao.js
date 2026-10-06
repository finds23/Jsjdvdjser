/**
 * SeriesKao (serieskao.top) - plugin para Nuvio
 * Servidores soportados: VOE y StreamWish (VidHide descartado: no funciona).
 * Flujo A: TMDB -> IMDB -> /vidurl/<imdb>[-SxEE]/ (dataLink cifrado + POW) -> embeds
 * Flujo B: TMDB -> busqueda en el sitio -> pagina del episodio -> botones de servidor -> embeds
 *
 * MODO DIAGNOSTICO: con DEBUG = true, la lista de Nuvio muestra una entrada "DIAGNOSTICO"
 * que indica en que paso fallo: BUSQUEDA, EPISODIO o SERVIDOR. Poner DEBUG = false cuando todo funcione.
 */
var CryptoJS = require("crypto-js");

var BASE_URL = "https://serieskao.top";
var TMDB_API_KEY = "1c29a5198ee1854bd5eb45dbe8d17d92";
var TMDB_BASE_URL = "https://api.themoviedb.org/3";
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
var HEADERS = {
  "User-Agent": UA,
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "es-MX,es;q=0.9,en-US;q=0.8,en;q=0.7",
  "Referer": BASE_URL + "/"
};
var LANG_PRIORITY = ["LAT", "ESP", "SUB"];
var LANG_LABELS = { LAT: "Latino", ESP: "Espa\u00F1ol", SUB: "Subtitulado" };

// Servidores activos. Todo lo demas (vidhide, filemoon, doodstream...) se omite.
var ENABLED_SOURCES = { voe: true, streamwish: true };
var SOURCE_LABELS = { voe: "VOE", streamwish: "StreamWish" };
var HOST_HINTS = {
  voe: ["voe.sx", "jennysteady.com"],
  streamwish: ["streamwish", "wishembed", "hglink.to", "filelions", "hlswish", "vibuxer", "awish"]
};

// ---------- diagnostico ----------
var VERSION = "1.1.1"; // se muestra en el diagnostico para saber que copia carga Nuvio
var DEBUG = true;
var TRACE = [];
var FAIL = null;
var SKIPPED = [];
function addTrace(prefix, stage, msg) {
  TRACE.push((prefix + "[" + stage + "] " + msg).replace(/\s+/g, " ").slice(0, 160));
}
function trace(stage, msg) { addTrace("", stage, msg); }
function ok(stage, msg) { addTrace("\u2714 ", stage, msg); }
function fail(stage, msg) { if (!FAIL) FAIL = stage; addTrace("\u2716 ", stage, msg); }
function skip(name) {
  name = String(name || "?").toLowerCase();
  if (SKIPPED.indexOf(name) !== -1) return;
  SKIPPED.push(name);
  trace("SERVIDOR", "omitido (no soportado): " + name);
}
function shortErr(e) { return String(e && e.message || e).replace(/ en https?:\/\/\S+/, ""); }
function looksBlocked(html) {
  return /just a moment|cf-chl|challenge-platform|attention required|enable javascript and cookies/i.test(html || "");
}
function hostOf(u) { try { return new URL(u).host; } catch (e) { return "?"; } }
function diagnostic(count) {
  if (!DEBUG) return [];
  var lines = TRACE.slice();
  lines.push(count > 0
    ? "\u2192 " + count + " stream(s) reproducibles, pero hubo fallos"
    : "\u2192 SIN STREAMS. Fallo en: " + (FAIL || "desconocido"));
  return [{
    name: "SeriesKao",
    title: "",
    url: BASE_URL + "/",
    quality: "\uD83D\uDEE0 DIAGNOSTICO (no reproducir)\n" + lines.join("\n"),
    headers: {}
  }];
}
function finish(streams) {
  if (streams.length === 0) return diagnostic(0);
  if (DEBUG && TRACE.some(function (t) { return t.charAt(0) === "\u2716"; })) return streams.concat(diagnostic(streams.length));
  return streams;
}

// ---------- utilidades ----------
async function fetchText(url, extraHeaders) {
  var response = await fetch(url, {
    headers: Object.assign({}, HEADERS, extraHeaders || {}),
    redirect: "follow"
  });
  if (!response.ok) throw new Error("HTTP " + response.status + " en " + url);
  return await response.text();
}

function decodeEntities(s) {
  return String(s).replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

function matchQuality(text) {
  if (!text) return "1080p";
  var v = String(text).toLowerCase();
  if (v.includes("2160") || v.includes("4k")) return "4K";
  if (v.includes("1440")) return "1440p";
  if (v.includes("1080")) return "1080p";
  if (v.includes("720")) return "720p";
  if (v.includes("480")) return "480p";
  if (v.includes("360")) return "360p";
  return "1080p";
}

function normalizeTitle(title) {
  if (!title) return "";
  return title.toLowerCase()
    .replace(/\b(the|a|an|el|la|los|las|un|una)\b/g, "")
    .replace(/[:\-_*]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[^\w\s\u00C0-\u024F]/g, "")
    .trim();
}

function calculateTitleSimilarity(title1, title2) {
  var norm1 = normalizeTitle(title1);
  var norm2 = normalizeTitle(title2);
  if (!norm1 || !norm2) return 0;
  if (norm1 === norm2) return 1;
  if (norm1.includes(norm2) || norm2.includes(norm1)) return 0.85;
  var words1 = norm1.split(/\s+/).filter(Boolean);
  var words2 = norm2.split(/\s+/).filter(Boolean);
  var set2 = new Set(words2);
  var intersection = words1.filter(function (w) { return set2.has(w); });
  var union = new Set(words1.concat(words2));
  return intersection.length / union.size;
}

function detectSource(name, url) {
  var n = String(name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  var u = String(url || "").toLowerCase();
  var keys = Object.keys(ENABLED_SOURCES).filter(function (k) { return ENABLED_SOURCES[k]; });
  for (var i = 0; i < keys.length; i++) {
    if (n && n.indexOf(keys[i]) !== -1) return keys[i];
    var hints = HOST_HINTS[keys[i]] || [];
    for (var j = 0; j < hints.length; j++) {
      if (u.indexOf(hints[j]) !== -1) return keys[i];
    }
  }
  return null;
}

// ---------- TMDB ----------
function buildSearchQueries(mediaInfo) {
  var queries = [];
  var add = function (q) {
    q = (q || "").trim();
    if (q.length >= 2 && queries.indexOf(q) === -1) queries.push(q);
  };
  add(mediaInfo.title);
  add(mediaInfo.originalTitle);
  var titles = [mediaInfo.title, mediaInfo.originalTitle];
  for (var t = 0; t < titles.length; t++) {
    var words = normalizeTitle(titles[t]).split(/\s+/).filter(function (w) { return w.length >= 3; });
    if (words.length > 0) add(words[0]);
    if (words.length > 1) add(words.slice(0, 2).join(" "));
  }
  if (mediaInfo.alternativeTitles) {
    for (var i = 0; i < mediaInfo.alternativeTitles.length; i++) add(mediaInfo.alternativeTitles[i]);
  }
  return queries;
}

async function getTMDBAlternativeTitles(tmdbId, mediaType) {
  var titles = [];
  try {
    var endpoint = mediaType === "tv" ? "tv" : "movie";
    var altRes = await fetch(TMDB_BASE_URL + "/" + endpoint + "/" + tmdbId + "/alternative_titles?api_key=" + TMDB_API_KEY, { headers: { "User-Agent": UA } });
    if (altRes.ok) {
      var altData = await altRes.json();
      var list = altData.results || altData.titles || [];
      for (var i = 0; i < list.length; i++) {
        if (list[i].title) titles.push(list[i].title);
        if (list[i].name) titles.push(list[i].name);
      }
    }
    var trRes = await fetch(TMDB_BASE_URL + "/" + endpoint + "/" + tmdbId + "/translations?api_key=" + TMDB_API_KEY, { headers: { "User-Agent": UA } });
    if (trRes.ok) {
      var trData = await trRes.json();
      var trans = trData.translations || [];
      for (var j = 0; j < trans.length; j++) {
        if (trans[j].iso_639_1 === "es" && trans[j].data) {
          if (trans[j].data.title) titles.push(trans[j].data.title);
          if (trans[j].data.name) titles.push(trans[j].data.name);
        }
      }
    }
  } catch (e) { /* los titulos alternativos son opcionales */ }
  return titles;
}

async function getTMDBDetails(tmdbId, mediaType) {
  var endpoint = mediaType === "tv" ? "tv" : "movie";
  var response = await fetch(TMDB_BASE_URL + "/" + endpoint + "/" + tmdbId + "?api_key=" + TMDB_API_KEY, {
    headers: { "Accept": "application/json", "User-Agent": UA }
  });
  if (!response.ok) throw new Error("TMDB HTTP " + response.status);
  var data = await response.json();
  var title = mediaType === "tv" ? data.name : data.title;
  var releaseDate = mediaType === "tv" ? data.first_air_date : data.release_date;
  var year = releaseDate ? parseInt(releaseDate.split("-")[0], 10) : null;
  return { title: title, year: year, originalTitle: data.original_title || data.original_name || title };
}

async function getImdbId(tmdbId, mediaType) {
  var endpoint = mediaType === "tv" ? "tv" : "movie";
  var response = await fetch(TMDB_BASE_URL + "/" + endpoint + "/" + tmdbId + "/external_ids?api_key=" + TMDB_API_KEY, { headers: { "User-Agent": UA } });
  if (!response.ok) return null;
  var data = await response.json();
  return data.imdb_id || null;
}

// ---------- busqueda en el sitio ----------
function parseSearchResults(html) {
  var results = [];
  var cardRegex = /<article class="card">([\s\S]*?)<\/article>/gi;
  var match;
  while ((match = cardRegex.exec(html)) !== null) {
    var block = match[1];
    var hrefMatch = block.match(/href="([^"]+)"/i);
    var titleMatch = block.match(/class="card__title">([^<]+)</i);
    var yearMatch = block.match(/card__badge--year">(\d{4})</i);
    var typeMatch = block.match(/card__badge--type">([A-Z]+)</i);
    if (!hrefMatch || !titleMatch) continue;
    results.push({
      href: hrefMatch[1],
      title: titleMatch[1].trim(),
      year: yearMatch ? parseInt(yearMatch[1], 10) : null,
      type: typeMatch ? typeMatch[1] : null
    });
  }
  return results;
}

function scoreMatch(mediaInfo, result, mediaType) {
  var score = calculateTitleSimilarity(mediaInfo.title, result.title);
  if (mediaInfo.originalTitle) score = Math.max(score, calculateTitleSimilarity(mediaInfo.originalTitle, result.title));
  if (mediaInfo.alternativeTitles) {
    for (var i = 0; i < mediaInfo.alternativeTitles.length; i++) {
      score = Math.max(score, calculateTitleSimilarity(mediaInfo.alternativeTitles[i], result.title));
    }
  }
  var normResult = normalizeTitle(result.title);
  var normSearch = normalizeTitle(mediaInfo.title);
  if (normResult.includes(normSearch) || normSearch.includes(normResult)) score = Math.max(score, 0.8);
  var firstWord = normSearch.split(/\s+/)[0];
  if (firstWord && firstWord.length >= 4 && normResult.indexOf(firstWord) === 0) score = Math.max(score, 0.55);
  if (mediaInfo.year && result.year === mediaInfo.year) score += 0.25;
  var expectedType = mediaType === "movie" ? "PEL" : "SER";
  if (result.type === expectedType) score += 0.1;
  else if (result.type && result.type !== expectedType) score -= 0.3;
  return score;
}

function findBestMatch(mediaInfo, searchResults, mediaType) {
  if (!searchResults || searchResults.length === 0) return null;
  var bestMatch = null;
  var bestScore = 0;
  for (var i = 0; i < searchResults.length; i++) {
    var score = scoreMatch(mediaInfo, searchResults[i], mediaType);
    if (score > bestScore && score > 0.2) {
      bestScore = score;
      bestMatch = searchResults[i];
    }
  }
  return bestMatch;
}

function topScores(mediaInfo, results, mediaType) {
  return results
    .map(function (r) { return { r: r, s: scoreMatch(mediaInfo, r, mediaType) }; })
    .sort(function (a, b) { return b.s - a.s; })
    .slice(0, 3)
    .map(function (x) { return x.r.title + "(" + x.s.toFixed(2) + ")"; })
    .join(", ");
}

async function searchSite(mediaInfo, mediaType) {
  var queries = buildSearchQueries(mediaInfo);
  var allResults = [];
  var seen = new Set();
  for (var i = 0; i < queries.length; i++) {
    try {
      var searchHtml = await fetchText(BASE_URL + "/search?s=" + encodeURIComponent(queries[i]));
      var results = parseSearchResults(searchHtml);
      trace("BUSQUEDA", "'" + queries[i] + "': " + results.length + " tarjetas" + (looksBlocked(searchHtml) ? ", CLOUDFLARE" : ""));
      for (var j = 0; j < results.length; j++) {
        var key = results[j].href + "|" + results[j].title;
        if (!seen.has(key)) {
          seen.add(key);
          allResults.push(results[j]);
        }
      }
      if (allResults.length > 0 && findBestMatch(mediaInfo, allResults, mediaType)) break;
    } catch (e) {
      trace("BUSQUEDA", "'" + queries[i] + "' fallo: " + shortErr(e));
    }
  }
  return allResults;
}

function buildWatchUrl(match, mediaType, season, episode) {
  if (mediaType === "movie") return BASE_URL + match.href;
  var slug = match.href.replace(/\/$/, "");
  return BASE_URL + slug + "/temporada/" + (parseInt(season, 10) || 1) + "/capitulo/" + (parseInt(episode, 10) || 1);
}

function buildVidUrlFallback(imdbId, mediaType, season, episode) {
  if (!imdbId) return null;
  if (mediaType === "movie") return BASE_URL + "/vidurl/" + imdbId + "/";
  var epSlug = (parseInt(season, 10) || 1) + "x" + String(parseInt(episode, 10) || 1).padStart(2, "0");
  return BASE_URL + "/vidurl/" + imdbId + "-" + epSlug + "/";
}

function parseServers(html) {
  var servers = [];
  var regex = /<button class="server-btn[^"]*"[^>]*data-url="([^"]*)"[^>]*>([^<]*)<\/button>/gi;
  var match;
  while ((match = regex.exec(html)) !== null) {
    var url = match[1].trim();
    var name = match[2].trim();
    if (!url) continue;
    if (url.startsWith("/")) url = BASE_URL + url;
    servers.push({ name: name, url: url });
  }
  return servers;
}

// ---------- vidurl (dataLink cifrado + POW) ----------
function decryptEmbedLink(encryptedBase64, aesKey) {
  try {
    var wordArray = CryptoJS.enc.Base64.parse(encryptedBase64);
    var iv = CryptoJS.lib.WordArray.create(wordArray.words.slice(0, 4), 16);
    var ciphertext = CryptoJS.lib.WordArray.create(wordArray.words.slice(4), wordArray.sigBytes - 16);
    var cipherParams = CryptoJS.lib.CipherParams.create({ ciphertext: ciphertext });
    var decrypted = CryptoJS.AES.decrypt(cipherParams, aesKey, { iv: iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 });
    return decrypted.toString(CryptoJS.enc.Utf8) || null;
  } catch (e) {
    return null;
  }
}

function solvePowAndGetKey(html) {
  var challengeMatch = html.match(/POW_CHALLENGE\s*=\s*'([^']+)'/);
  var difficultyMatch = html.match(/POW_DIFFICULTY\s*=\s*(\d+)/);
  var saltMatch = html.match(/POW_SALT\s*=\s*'([^']+)'/);
  if (!challengeMatch || !difficultyMatch || !saltMatch) return null;
  var challenge = challengeMatch[1];
  var prefix = "0".repeat(parseInt(difficultyMatch[1], 10));
  var salt = saltMatch[1];
  for (var nonce = 0; nonce < 3000000; nonce++) { // tope para no colgar el plugin
    var hash = CryptoJS.SHA256(challenge + nonce).toString(CryptoJS.enc.Hex);
    if (hash.startsWith(prefix)) return CryptoJS.SHA256(challenge + nonce + salt);
  }
  return null;
}

function parseDataLink(html) {
  var match = html.match(/(?:let|var)\s+dataLink\s*=\s*(\[.+\]);/);
  if (!match) return null;
  try { return JSON.parse(match[1]); } catch (e) { return null; }
}

// ---------- extractor VOE (portado de AnimeJara + metodo anterior como respaldo) ----------
var VOE_MARKERS = ["@$", "^^", "~@", "%?", "*~", "!!", "#&"];
function voeRot13(str) {
  return str.replace(/[a-zA-Z]/g, function (c) {
    var code = c.charCodeAt(0), base = code <= 90 ? 65 : 97;
    return String.fromCharCode((code - base + 13) % 26 + base);
  });
}
function decodeVoePayload(raw) {
  var x = voeRot13(raw);
  VOE_MARKERS.forEach(function (mk) { x = x.split(mk).join("_"); });
  x = x.split("_").join("");
  x = atob(x);
  x = Array.from(x).map(function (c) { return String.fromCharCode((c.charCodeAt(0) - 3 + 256) % 256); }).join("");
  x = x.split("").reverse().join("");
  x = atob(x);
  return JSON.parse(x);
}
// Metodo anterior de SeriesKao: los marcadores vienen en un script externo
function decodeVoePayloadLoader(encoded, replacementsRaw) {
  try {
    var replacements = replacementsRaw.replace(/^\[|\]$/g, "").split("','")
      .map(function (item) { return item.replace(/^'+|'+$/g, ""); })
      .map(function (item) { return item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); });
    var shifted = "";
    for (var i = 0; i < encoded.length; i++) {
      var code = encoded.charCodeAt(i);
      if (code > 64 && code < 91) code = (code - 52) % 26 + 65;
      else if (code > 96 && code < 123) code = (code - 84) % 26 + 97;
      shifted += String.fromCharCode(code);
    }
    for (var j = 0; j < replacements.length; j++) shifted = shifted.replace(new RegExp(replacements[j], "g"), "_");
    shifted = shifted.split("_").join("");
    var step1 = atob(shifted);
    var step2 = "";
    for (var k = 0; k < step1.length; k++) step2 += String.fromCharCode((step1.charCodeAt(k) - 3 + 256) % 256);
    return JSON.parse(atob(step2.split("").reverse().join("")));
  } catch (e) {
    return null;
  }
}
function voeResultFromDecoded(decoded, origin) {
  var out = [];
  var hls = decoded && (decoded.source || decoded.direct_access_url);
  if (hls) out.push({ url: hls, type: "hls", tag: "HLS", headers: { "Referer": origin + "/", "User-Agent": UA } });
  var mp4 = decoded && decoded.fallback && decoded.fallback[0] && decoded.fallback[0].file;
  if (mp4) out.push({ url: mp4, tag: "MP4", headers: { "User-Agent": UA } });
  return out;
}
async function extractVoe(embedUrl, referer) {
  async function getHtml(url, ref) {
    var resp = await fetch(url, { headers: { "User-Agent": UA, "Referer": ref } });
    if (!resp.ok) throw new Error("HTTP " + resp.status + " en " + url);
    return { html: await resp.text(), url: resp.url || url };
  }
  // Busca el video en una pagina de VOE con los tres metodos conocidos
  async function tryPage(page) {
    var origin;
    try { origin = new URL(page.url).origin; } catch (e) { origin = new URL(embedUrl).origin; }
    // 1) JSON del embed ofuscado con marcadores fijos
    var sm = page.html.match(/<script type="application\/json"[^>]*>([\s\S]*?)<\/script>/i);
    if (sm) {
      try {
        var arr = JSON.parse(decodeEntities(sm[1].trim()));
        if (Array.isArray(arr) && arr[0]) {
          var out = voeResultFromDecoded(decodeVoePayload(arr[0]), origin);
          if (out.length) return out;
        }
      } catch (e) { trace("SERVIDOR", "VOE metodo 1: " + shortErr(e)); }
    }
    // 2) metodo anterior: marcadores en script externo
    var em = page.html.match(/json">\s*\[\s*['"]([^'"]+)['"]\s*\]\s*<\/script>\s*<script[^>]*src=['"]([^'"]+)['"]/i);
    if (em) {
      try {
        var loaderUrl = em[2].indexOf("http") === 0 ? em[2] : new URL(em[2], page.url).href;
        var lr = await fetch(loaderUrl, { headers: { "User-Agent": UA, "Referer": page.url } });
        if (lr.ok) {
          var lt = await lr.text();
          var am = lt.match(/(\[(?:'[^']{1,10}'[\s,]*){4,12}\])/i) || lt.match(/(\[(?:"[^"]{1,10}"[,\s]*){4,12}\])/i);
          if (am) {
            var out2 = voeResultFromDecoded(decodeVoePayloadLoader(em[1], am[1]), origin);
            if (out2.length) return out2;
          }
        }
      } catch (e) { trace("SERVIDOR", "VOE metodo 2: " + shortErr(e)); }
    }
    // 3) enlaces en claro
    var sourceRegex = /(?:mp4|hls)'\s*:\s*'([^']+)'/gi;
    var sourceMatch;
    while ((sourceMatch = sourceRegex.exec(page.html)) !== null) {
      var link = sourceMatch[1];
      if (link.indexOf("aHR0") === 0) { try { link = atob(link); } catch (e) { /* seguir */ } }
      if (link) return [{ url: link, headers: { "Referer": origin + "/", "User-Agent": UA } }];
    }
    return null;
  }

  // Primero la pagina original (puede traer el video sin pasar por la redireccion)
  var first = await getHtml(embedUrl, referer || BASE_URL + "/");
  var found = await tryPage(first);
  if (found) return found;
  var last = first;
  var jsRedirect = first.html.match(/window\.location\.href\s*=\s*['"]([^'"]+)['"]/i);
  if (jsRedirect) {
    trace("SERVIDOR", "VOE " + hostOf(first.url) + " redirige a " + hostOf(jsRedirect[1]));
    last = await getHtml(jsRedirect[1], first.url);
    found = await tryPage(last);
    if (found) return found;
  }
  trace("SERVIDOR", "VOE " + hostOf(last.url) + ": " + describeHtml(last.html));
  if (/confirm you.{1,6}re human|captcha|turnstile/i.test(decodeEntities(last.html))) {
    throw new Error("VOE: pide verificacion humana (anti-bot) en " + hostOf(last.url));
  }
  throw new Error("VOE: no se encontro el video");
}

// ---------- extractor StreamWish (portado de AnimeJara) ----------
function packEnc(c, a) {
  return (c < a ? "" : packEnc(parseInt(c / a, 10), a)) + ((c = c % a) > 35 ? String.fromCharCode(c + 29) : c.toString(36));
}
// Desempaqueta eval(function(p,a,c,k,e,d){...}) de Dean Edwards (base 2-62)
function unpackPacker(src) {
  var m = /\}\(\s*(['"])((?:\\[\s\S]|(?!\1)[^\\])*)\1\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(['"])((?:\\[\s\S]|(?!\5)[^\\])*)\5\s*\.split\(\s*['"]\|['"]\s*\)/.exec(src);
  if (!m) return null;
  var p = m[2].replace(/\\(['"\\\/])/g, "$1");
  var radix = parseInt(m[3], 10), count = parseInt(m[4], 10), dict = m[6].split("|");
  var map = {};
  for (var c = count - 1; c >= 0; c--) {
    var key = packEnc(c, radix);
    map[key] = dict[c] || key;
  }
  return p.replace(/\b\w+\b/g, function (w) { return Object.prototype.hasOwnProperty.call(map, w) ? map[w] : w; });
}
function describeHtml(html) {
  var t = /<title[^>]*>([^<]*)/i.exec(html || "");
  return (html || "").length + "b" +
    ", packer=" + (/eval\(function\(p,a,c,k,e,d\)/.test(html) ? "si" : "no") +
    ", m3u8=" + (/m3u8/.test(html) ? "si" : "no") +
    ", sources=" + (/sources\s*:/.test(html) ? "si" : "no") +
    (looksBlocked(html) ? ", CLOUDFLARE" : "") +
    ", titulo=" + (t ? decodeEntities(t[1].trim()).slice(0, 30) : "?");
}
function extractHlsFromHtml(html) {
  var texts = [html];
  var re = /eval\(function\(p,a,c,k,e,d\)[\s\S]*?\.split\(\s*['"]\|['"]\s*\)[^\n]*?\)\)/g, m;
  while ((m = re.exec(html)) !== null) {
    try {
      var u = unpackPacker(m[0]);
      if (u) texts.unshift(u);
      else trace("SERVIDOR", "packer: no se pudo leer");
    } catch (e) { trace("SERVIDOR", "packer error: " + shortErr(e)); }
  }
  for (var i = 0; i < texts.length; i++) {
    var lm = /var\s+links\s*=\s*(\{[\s\S]*?\})\s*;/.exec(texts[i]);
    if (lm) {
      try {
        var links = JSON.parse(lm[1]);
        var best = links.hls4 || links.hls2 || links.hls3 || links.hls1 || links.hls;
        if (!best) Object.keys(links).forEach(function (k) { if (!best && /\.m3u8/.test(String(links[k]))) best = links[k]; });
        if (best) return best;
      } catch (e) { /* seguir */ }
    }
    var jm = /["']hls\d?["']\s*:\s*["']([^"']+)["']/.exec(texts[i]);
    if (jm) return jm[1].replace(/\\\//g, "/");
    var fm = /https?:\/\/[^"'\s\\]+\.m3u8[^"'\s\\]*/.exec(texts[i]);
    if (fm) return fm[0];
    var fl = /file\s*:\s*["']([^"']+\.(?:m3u8|mp4)[^"']*)["']/.exec(texts[i]);
    if (fl) return fl[1];
    var rel = /["'](\/[^"'\s\\]+\.m3u8[^"'\s\\]*)["']/.exec(texts[i]);
    if (rel) return rel[1];
  }
  return null;
}
// Redireccion por JS / meta refresh / iframe en paginas "Loading..."
function findJsRedirect(html, baseUrl) {
  var pats = [
    /(?:window\.|document\.|top\.|self\.)?location(?:\.href)?\s*=\s*["']([^"']+)["']/i,
    /location\.(?:replace|assign)\(\s*["']([^"']+)["']\s*\)/i,
    /<meta[^>]+http-equiv=["']?refresh["']?[^>]+url=\s*["']?([^"'>\s]+)/i,
    /<iframe[^>]+src=["']([^"']+)["']/i
  ];
  for (var i = 0; i < pats.length; i++) {
    var m = pats[i].exec(html);
    if (m) {
      try { return new URL(m[1].replace(/&amp;/g, "&").replace(/\\\//g, "/"), baseUrl).href; } catch (e) { /* siguiente */ }
    }
  }
  return null;
}
async function extractStreamWish(embedUrl, referer) {
  referer = referer || BASE_URL + "/";
  var pageUrl = embedUrl.replace("hglink.to", "vibuxer.com");
  var html = "", url = null;
  for (var hop = 0; hop < 4; hop++) {
    var resp = await fetch(pageUrl, { headers: { "User-Agent": UA, "Referer": referer, "Accept": "text/html,application/xhtml+xml" } });
    if (!resp.ok) throw new Error("HTTP " + resp.status + " en " + pageUrl);
    html = await resp.text();
    pageUrl = resp.url || pageUrl;
    url = extractHlsFromHtml(html);
    if (url) break;
    var next = findJsRedirect(html, pageUrl);
    if (!next || next === pageUrl) break;
    trace("SERVIDOR", "embed " + hostOf(pageUrl) + " redirige a " + hostOf(next));
    referer = pageUrl;
    pageUrl = next;
  }
  var origin;
  try { origin = new URL(pageUrl).origin; } catch (e) { origin = "https://hlswish.com"; }
  if (!url) {
    trace("SERVIDOR", "StreamWish " + hostOf(pageUrl) + ": " + describeHtml(html));
    if (html.length < 3000) trace("SERVIDOR", "cuerpo: " + html.replace(/\s+/g, " ").slice(0, 130));
    throw new Error("StreamWish: no se encontro la URL HLS en " + hostOf(pageUrl));
  }
  url = String(url).replace(/\\\//g, "/");
  if (url.indexOf("//") === 0) url = "https:" + url;
  else if (url.charAt(0) === "/") url = origin + url;
  return [{ url: url, type: "hls", headers: { "Referer": origin + "/", "Origin": origin, "User-Agent": UA } }];
}

async function extractBySource(source, url, referer) {
  if (source === "voe") return await extractVoe(url, referer);
  return await extractStreamWish(url, referer);
}

// Diagnostico: pide el enlace final con sus headers para ver si responde (HTTP, #EXTM3U)
async function probeStream(label, v) {
  if (!DEBUG || !v || !v.url) return;
  try {
    var h = Object.assign({ "User-Agent": UA, "Referer": BASE_URL + "/" }, v.headers || {}, { "Range": "bytes=0-400" });
    var r = await fetch(v.url, { headers: h });
    var ctype = "";
    try { ctype = (r.headers && r.headers.get && r.headers.get("content-type")) || ""; } catch (e) { /* sin headers */ }
    var isM3u8 = /m3u8/i.test(v.url) || /mpegurl/i.test(ctype);
    var detail = ctype.split(";")[0] || "?";
    var bad = !r.ok;
    if (isM3u8) {
      var body = "";
      try { body = (await r.text()).slice(0, 80); } catch (e) { /* sin cuerpo */ }
      if (r.ok && body.indexOf("#EXTM3U") === 0) detail = "#EXTM3U ok";
      else { detail = "cuerpo: " + body.replace(/\s+/g, " ").slice(0, 50); bad = true; }
    }
    (bad ? fail : ok)("SERVIDOR", label + " prueba " + hostOf(v.url) + ": HTTP " + r.status + ", " + detail);
    trace("SERVIDOR", "url " + String(v.url).slice(0, 140));
  } catch (e) {
    fail("SERVIDOR", label + " prueba " + hostOf(v.url) + ": " + shortErr(e));
  }
}

function makeStream(label, langLabel, v) {
  var o = {
    name: "SeriesKao",
    title: "SeriesKao - " + label + (v.tag ? " [" + v.tag + "]" : "") + (langLabel ? " (" + langLabel + ")" : ""),
    url: v.url,
    quality: matchQuality(label),
    headers: Object.assign({ "User-Agent": UA, "Referer": BASE_URL + "/" }, v.headers || {}),
    provider: "serieskao"
  };
  if (v.type) o.type = v.type;
  return o;
}

// ---------- paso EPISODIO/SERVIDOR via /vidurl/ ----------
async function resolveVidUrlPage(vidUrl) {
  var html;
  try {
    html = await fetchText(vidUrl, { Referer: BASE_URL + "/" });
  } catch (e) {
    fail("EPISODIO", "vidurl " + shortErr(e));
    return [];
  }
  var dataLink = parseDataLink(html);
  if (!dataLink || dataLink.length === 0) {
    fail("EPISODIO", "vidurl sin dataLink (" + html.length + "b" + (looksBlocked(html) ? ", CLOUDFLARE" : "") + ")");
    return [];
  }
  var aesKey = solvePowAndGetKey(html);
  if (!aesKey) {
    fail("EPISODIO", "vidurl: no se resolvio el POW / clave AES");
    return [];
  }
  trace("EPISODIO", "vidurl ok, idiomas: " + dataLink.map(function (d) { return (d.video_language || "?") + "(" + ((d.sortedEmbeds || []).length) + ")"; }).join(" "));

  var streams = [];
  var seen = {};
  for (var li = 0; li < LANG_PRIORITY.length; li++) {
    var langCode = LANG_PRIORITY[li];
    var langBlock = null;
    for (var i = 0; i < dataLink.length; i++) {
      if ((dataLink[i].video_language || "").toUpperCase() === langCode) { langBlock = dataLink[i]; break; }
    }
    if (!langBlock || !langBlock.sortedEmbeds) continue;
    var langLabel = LANG_LABELS[langCode];
    var jobs = langBlock.sortedEmbeds.map(async function (embed) {
      if (!embed.link || embed.servername === "download") return [];
      var decrypted = decryptEmbedLink(embed.link, aesKey);
      if (!decrypted) {
        fail("SERVIDOR", (embed.servername || "?") + " (" + langLabel + "): no se pudo descifrar el enlace");
        return [];
      }
      var source = detectSource(embed.servername, decrypted);
      if (!source) { skip(embed.servername || hostOf(decrypted)); return []; }
      var label = SOURCE_LABELS[source];
      try {
        var list = await extractBySource(source, decrypted, BASE_URL + "/");
        await probeStream(label, list[0]);
        var out = [];
        list.forEach(function (v) {
          if (!v || !v.url || seen[v.url]) return;
          seen[v.url] = true;
          out.push(makeStream(label, langLabel, v));
        });
        ok("SERVIDOR", label + " (" + langLabel + "): " + out.length + " enlace(s)");
        return out;
      } catch (e) {
        fail("SERVIDOR", label + " (" + langLabel + ") en " + hostOf(decrypted) + ": " + shortErr(e));
        return [];
      }
    });
    var done = await Promise.all(jobs);
    done.forEach(function (arr) { streams = streams.concat(arr); });
    if (streams.length > 0) break; // se queda con el primer idioma que tenga resultados
  }
  if (streams.length === 0 && !FAIL) fail("SERVIDOR", "vidurl sin servidores VOE/StreamWish");
  return streams;
}

// ---------- paso SERVIDOR via botones del episodio ----------
async function resolveServer(server) {
  var url = server.url;
  if (url.indexOf("/vidurl/") !== -1) return await resolveVidUrlPage(url);
  if (/\.(m3u8|mp4)(\?|$)/i.test(url)) {
    return [makeStream(server.name, "", { url: url })];
  }
  var source = detectSource(server.name, url);
  if (!source) { skip(server.name || hostOf(url)); return []; }
  var label = SOURCE_LABELS[source];
  try {
    var list = await extractBySource(source, url, BASE_URL + "/");
    await probeStream(label, list[0]);
    ok("SERVIDOR", label + ": " + list.length + " enlace(s)");
    return list.map(function (v) { return makeStream(label, "", v); });
  } catch (e) {
    fail("SERVIDOR", label + " en " + hostOf(url) + ": " + shortErr(e));
    return [];
  }
}

// ---------- punto de entrada ----------
async function getStreams(tmdbId, mediaType, season, episode) {
  TRACE = [];
  FAIL = null;
  SKIPPED = [];
  trace("INFO", "SeriesKao v" + VERSION);
  try {
    var mediaInfo;
    try {
      mediaInfo = await getTMDBDetails(tmdbId, mediaType);
    } catch (e) {
      fail("TMDB", shortErr(e));
      return diagnostic(0);
    }
    ok("TMDB", mediaInfo.title + " (" + mediaInfo.year + ")" + (mediaType === "tv" ? " T" + (season || 1) + "E" + (episode || 1) : ""));

    // Ruta A: IMDB -> /vidurl/
    var imdbId = null;
    try { imdbId = await getImdbId(tmdbId, mediaType); } catch (e) { /* sin IMDB */ }
    var vidUrl = buildVidUrlFallback(imdbId, mediaType, season, episode);
    if (vidUrl) {
      trace("EPISODIO", "ruta A: " + vidUrl.replace(BASE_URL, ""));
      var imdbStreams = await resolveVidUrlPage(vidUrl);
      if (imdbStreams.length > 0) return finish(imdbStreams);
    } else {
      trace("EPISODIO", "ruta A omitida: TMDB no devolvio IMDB id");
    }

    // Ruta B: busqueda -> pagina del episodio -> botones de servidor
    FAIL = null; // el diagnostico final refleja donde fallo esta ruta
    mediaInfo.alternativeTitles = await getTMDBAlternativeTitles(tmdbId, mediaType);
    var searchResults = await searchSite(mediaInfo, mediaType);
    if (searchResults.length === 0) {
      fail("BUSQUEDA", "el sitio no devolvio tarjetas para ninguna consulta");
      return diagnostic(0);
    }
    var match = findBestMatch(mediaInfo, searchResults, mediaType);
    if (!match) {
      fail("BUSQUEDA", searchResults.length + " tarjetas pero ninguna coincide. Mejores: " + topScores(mediaInfo, searchResults, mediaType));
      return diagnostic(0);
    }
    ok("BUSQUEDA", "\"" + match.title + "\" (" + match.year + ", " + match.type + ") " + match.href);

    var watchUrl = buildWatchUrl(match, mediaType, season, episode);
    trace("EPISODIO", "GET " + watchUrl.replace(BASE_URL, ""));
    var watchHtml;
    try {
      watchHtml = await fetchText(watchUrl);
    } catch (e) {
      fail("EPISODIO", shortErr(e) + " (\u00BFexiste esa temporada/capitulo?)");
      return diagnostic(0);
    }
    var servers = parseServers(watchHtml);
    if (servers.length === 0) {
      fail("EPISODIO", "pagina sin botones de servidor (" + watchHtml.length + "b" + (looksBlocked(watchHtml) ? ", CLOUDFLARE" : "") + ")");
      return diagnostic(0);
    }
    ok("EPISODIO", servers.length + " servidores: " + servers.map(function (s) { return s.name; }).join(", "));

    var lists = await Promise.all(servers.map(function (s) { return resolveServer(s); }));
    var allStreams = [];
    var seenUrls = {};
    lists.forEach(function (list) {
      list.forEach(function (st) {
        if (st && st.url && !seenUrls[st.url]) { seenUrls[st.url] = true; allStreams.push(st); }
      });
    });
    if (allStreams.length === 0 && !FAIL) fail("SERVIDOR", "ningun servidor VOE/StreamWish disponible en este episodio");
    return finish(allStreams);
  } catch (error) {
    fail("ERROR", shortErr(error));
    return diagnostic(0);
  }
}

module.exports = { getStreams };
if (typeof globalThis !== "undefined") globalThis.getStreams = getStreams;

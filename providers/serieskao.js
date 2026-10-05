// SeriesKao Scraper for Nuvio Local Scrapers
// React Native compatible version

var __async = (__this, __arguments, generator) => {
  return new Promise((resolve, reject) => {
    var fulfilled = (value) => {
      try { step(generator.next(value)); } catch (e) { reject(e); }
    };
    var rejected = (value) => {
      try { step(generator.throw(value)); } catch (e) { reject(e); }
    };
    var step = (x) => x.done ? resolve(x.value) : Promise.resolve(x.value).then(fulfilled, rejected);
    step((generator = generator.apply(__this, __arguments)).next());
  });
};

var CryptoJS = require("crypto-js");

var BASE_URL = "https://serieskao.top";
var TMDB_API_KEY = "1c29a5198ee1854bd5eb45dbe8d17d92";
var TMDB_BASE_URL = "https://api.themoviedb.org/3";
var USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
var HEADERS = {
  "User-Agent": USER_AGENT,
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "es-MX,es;q=0.9,en-US;q=0.8,en;q=0.7",
  "Referer": BASE_URL + "/"
};
var LANG_PRIORITY = ["LAT", "ESP", "SUB"];
var SERVER_RESOLVERS = {
  "voe.sx": resolveVoe,
  "jennysteady.com": resolveVoe,
  "streamwish.com": resolveStreamWish,
  "streamwish.to": resolveStreamWish,
  "wishembed.online": resolveStreamWish,
  "filelions.com": resolveStreamWish,
  "hglink.to": resolveStreamWish,
  "vidhide.com": resolveVidHide,
  "dintezuvio.com": resolveVidHide,
  "minochinos.com": resolveVidHide
};
var SERVER_LABELS = {
  voe: "VOE",
  streamwish: "StreamWish",
  filemoon: "Filemoon",
  vidhide: "VidHide",
  doodstream: "Doodstream"
};

function fetchText(url, extraHeaders) {
  return __async(null, null, function* () {
    var response = yield fetch(url, {
      headers: Object.assign({}, HEADERS, extraHeaders || {}),
      redirect: "follow"
    });
    if (!response.ok) {
      throw new Error("HTTP " + response.status);
    }
    return yield response.text();
  });
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
  var intersection = words1.filter(function(w) { return set2.has(w); });
  var union = new Set(words1.concat(words2));
  return intersection.length / union.size;
}

function buildSearchQueries(mediaInfo) {
  var queries = [];
  var add = function(q) {
    q = (q || "").trim();
    if (q.length >= 2 && queries.indexOf(q) === -1) queries.push(q);
  };
  add(mediaInfo.title);
  add(mediaInfo.originalTitle);
  var titles = [mediaInfo.title, mediaInfo.originalTitle];
  for (var t = 0; t < titles.length; t++) {
    var words = normalizeTitle(titles[t]).split(/\s+/).filter(function(w) { return w.length >= 3; });
    if (words.length > 0) add(words[0]);
    if (words.length > 1) add(words.slice(0, 2).join(" "));
  }
  if (mediaInfo.alternativeTitles) {
    for (var i = 0; i < mediaInfo.alternativeTitles.length; i++) {
      add(mediaInfo.alternativeTitles[i]);
    }
  }
  return queries;
}

function getTMDBAlternativeTitles(tmdbId, mediaType) {
  return __async(null, null, function* () {
    var titles = [];
    try {
      var endpoint = mediaType === "tv" ? "tv" : "movie";
      var altUrl = TMDB_BASE_URL + "/" + endpoint + "/" + tmdbId + "/alternative_titles?api_key=" + TMDB_API_KEY;
      var altRes = yield fetch(altUrl, { headers: { "User-Agent": USER_AGENT } });
      if (altRes.ok) {
        var altData = yield altRes.json();
        var list = altData.results || altData.titles || [];
        for (var i = 0; i < list.length; i++) {
          if (list[i].title) titles.push(list[i].title);
          if (list[i].name) titles.push(list[i].name);
        }
      }
      var trUrl = TMDB_BASE_URL + "/" + endpoint + "/" + tmdbId + "/translations?api_key=" + TMDB_API_KEY;
      var trRes = yield fetch(trUrl, { headers: { "User-Agent": USER_AGENT } });
      if (trRes.ok) {
        var trData = yield trRes.json();
        var trans = trData.translations || [];
        for (var j = 0; j < trans.length; j++) {
          if (trans[j].iso_639_1 === "es" && trans[j].data) {
            if (trans[j].data.title) titles.push(trans[j].data.title);
            if (trans[j].data.name) titles.push(trans[j].data.name);
          }
        }
      }
    } catch (e) {}
    return titles;
  });
}

function searchSite(mediaInfo, mediaType) {
  return __async(null, null, function* () {
    var queries = buildSearchQueries(mediaInfo);
    var allResults = [];
    var seen = new Set();
    for (var i = 0; i < queries.length; i++) {
      try {
        var searchUrl = BASE_URL + "/search?s=" + encodeURIComponent(queries[i]);
        console.log('[SeriesKao] Search query: "' + queries[i] + '"');
        var searchHtml = yield fetchText(searchUrl);
        var results = parseSearchResults(searchHtml);
        for (var j = 0; j < results.length; j++) {
          var key = results[j].href + "|" + results[j].title;
          if (!seen.has(key)) {
            seen.add(key);
            allResults.push(results[j]);
          }
        }
        if (allResults.length > 0 && findBestMatch(mediaInfo, allResults, mediaType)) break;
      } catch (e) {}
    }
    return allResults;
  });
}

function scoreMatch(mediaInfo, result, mediaType) {
  var score = calculateTitleSimilarity(mediaInfo.title, result.title);
  if (mediaInfo.originalTitle) {
    score = Math.max(score, calculateTitleSimilarity(mediaInfo.originalTitle, result.title));
  }
  if (mediaInfo.alternativeTitles) {
    for (var i = 0; i < mediaInfo.alternativeTitles.length; i++) {
      score = Math.max(score, calculateTitleSimilarity(mediaInfo.alternativeTitles[i], result.title));
    }
  }
  var normResult = normalizeTitle(result.title);
  var normSearch = normalizeTitle(mediaInfo.title);
  if (normResult.includes(normSearch) || normSearch.includes(normResult)) {
    score = Math.max(score, 0.8);
  }
  var firstWord = normalizeTitle(mediaInfo.title).split(/\s+/)[0];
  if (firstWord && firstWord.length >= 4 && normResult.indexOf(firstWord) === 0) {
    score = Math.max(score, 0.55);
  }
  if (mediaInfo.year && result.year === mediaInfo.year) score += 0.25;
  var expectedType = mediaType === "movie" ? "PEL" : "SER";
  if (result.type === expectedType) score += 0.1;
  else if (result.type && result.type !== expectedType) score -= 0.3;
  return score;
}

function getTMDBDetails(tmdbId, mediaType) {
  return __async(null, null, function* () {
    var endpoint = mediaType === "tv" ? "tv" : "movie";
    var url = TMDB_BASE_URL + "/" + endpoint + "/" + tmdbId + "?api_key=" + TMDB_API_KEY;
    var response = yield fetch(url, {
      headers: { "Accept": "application/json", "User-Agent": USER_AGENT }
    });
    if (!response.ok) throw new Error("TMDB API error: " + response.status);
    var data = yield response.json();
    var title = mediaType === "tv" ? data.name : data.title;
    var releaseDate = mediaType === "tv" ? data.first_air_date : data.release_date;
    var year = releaseDate ? parseInt(releaseDate.split("-")[0], 10) : null;
    return { title: title, year: year, originalTitle: data.original_title || data.original_name || title };
  });
}

function getImdbId(tmdbId, mediaType) {
  return __async(null, null, function* () {
    var endpoint = mediaType === "tv" ? "tv" : "movie";
    var url = TMDB_BASE_URL + "/" + endpoint + "/" + tmdbId + "/external_ids?api_key=" + TMDB_API_KEY;
    var response = yield fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (!response.ok) return null;
    var data = yield response.json();
    return data.imdb_id || null;
  });
}

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

function findBestMatch(mediaInfo, searchResults, mediaType) {
  if (!searchResults || searchResults.length === 0) return null;
  var bestMatch = null;
  var bestScore = 0;
  for (var i = 0; i < searchResults.length; i++) {
    var result = searchResults[i];
    var score = scoreMatch(mediaInfo, result, mediaType);
    if (score > bestScore && score > 0.2) {
      bestScore = score;
      bestMatch = result;
    }
  }
  return bestMatch;
}

function buildWatchUrl(match, mediaType, season, episode) {
  if (mediaType === "movie") {
    return BASE_URL + match.href;
  }
  var slug = match.href.replace(/\/$/, "");
  var seasonNum = parseInt(season, 10) || 1;
  var episodeNum = parseInt(episode, 10) || 1;
  return BASE_URL + slug + "/temporada/" + seasonNum + "/capitulo/" + episodeNum;
}

function buildVidUrlFallback(imdbId, mediaType, season, episode) {
  if (!imdbId) return null;
  if (mediaType === "movie") {
    return BASE_URL + "/vidurl/" + imdbId + "/";
  }
  var seasonNum = parseInt(season, 10) || 1;
  var episodeNum = parseInt(episode, 10) || 1;
  var epSlug = seasonNum + "x" + String(episodeNum).padStart(2, "0");
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

function decryptEmbedLink(encryptedBase64, aesKey) {
  try {
    var wordArray = CryptoJS.enc.Base64.parse(encryptedBase64);
    var iv = CryptoJS.lib.WordArray.create(wordArray.words.slice(0, 4), 16);
    var ciphertext = CryptoJS.lib.WordArray.create(wordArray.words.slice(4), wordArray.sigBytes - 16);
    var cipherParams = CryptoJS.lib.CipherParams.create({ ciphertext: ciphertext });
    var decrypted = CryptoJS.AES.decrypt(cipherParams, aesKey, {
      iv: iv,
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.Pkcs7
    });
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
  var difficulty = parseInt(difficultyMatch[1], 10);
  var salt = saltMatch[1];
  var prefix = "0".repeat(difficulty);
  var nonce = 0;
  while (true) {
    var hash = CryptoJS.SHA256(challenge + nonce).toString(CryptoJS.enc.Hex);
    if (hash.startsWith(prefix)) {
      return CryptoJS.SHA256(challenge + nonce + salt);
    }
    nonce++;
  }
}

function parseDataLink(html) {
  var match = html.match(/(?:let|var)\s+dataLink\s*=\s*(\[.+\]);/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch (e) {
    return null;
  }
}

function getResolverForUrl(url) {
  if (!url) return null;
  var lower = url.toLowerCase();
  var keys = Object.keys(SERVER_RESOLVERS);
  for (var i = 0; i < keys.length; i++) {
    if (lower.includes(keys[i])) return SERVER_RESOLVERS[keys[i]];
  }
  return null;
}

function resolveVoe(url) {
  return __async(null, null, function* () {
    try {
      var response = yield fetch(url, {
        headers: { "User-Agent": USER_AGENT, "Referer": url }
      });
      if (!response.ok) return null;
      var html = yield response.text();
      var redirectMatch = html.match(/window\.location\.href\s*=\s*'([^']+)'/i);
      if (/permanentToken/i.test(html) && redirectMatch) {
        response = yield fetch(redirectMatch[1], { headers: { "User-Agent": USER_AGENT, "Referer": url } });
        if (response.ok) html = yield response.text();
      }
      var encodedMatch = html.match(/json">\s*\[\s*['"]([^'"]+)['"]\s*\]\s*<\/script>\s*<script[^>]*src=['"]([^'"]+)['"]/i);
      if (encodedMatch) {
        var encoded = encodedMatch[1];
        var loaderUrl = encodedMatch[2].startsWith("http") ? encodedMatch[2] : new URL(encodedMatch[2], url).href;
        var loaderResponse = yield fetch(loaderUrl, { headers: { "User-Agent": USER_AGENT, "Referer": url } });
        if (loaderResponse.ok) {
          var loaderText = yield loaderResponse.text();
          var arrayMatch = loaderText.match(/(\[(?:'[^']{1,10}'[\s,]*){4,12}\])/i) || loaderText.match(/(\[(?:"[^"]{1,10}"[,\s]*){4,12}\])/i);
          if (arrayMatch) {
            var decoded = decodeVoePayload(encoded, arrayMatch[1]);
            if (decoded && (decoded.source || decoded.direct_access_url)) {
              var streamUrl = decoded.source || decoded.direct_access_url;
              return { url: streamUrl, headers: { Referer: url } };
            }
          }
        }
      }
      var sourceRegex = /(?:mp4|hls)'\s*:\s*'([^']+)'/gi;
      var sourceMatch;
      while ((sourceMatch = sourceRegex.exec(html)) !== null) {
        var link = sourceMatch[1];
        if (link.startsWith("aHR0")) {
          try { link = atob(link); } catch (e) {}
        }
        if (link) return { url: link, headers: { Referer: url } };
      }
    } catch (e) {}
    return null;
  });
}

function decodeVoePayload(encoded, replacementsRaw) {
  try {
    var replacements = replacementsRaw.replace(/^\[|\]$/g, "").split("','")
      .map(function(item) { return item.replace(/^'+|'+$/g, ""); })
      .map(function(item) { return item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); });
    var shifted = "";
    for (var i = 0; i < encoded.length; i++) {
      var code = encoded.charCodeAt(i);
      if (code > 64 && code < 91) code = (code - 52) % 26 + 65;
      else if (code > 96 && code < 123) code = (code - 84) % 26 + 97;
      shifted += String.fromCharCode(code);
    }
    for (var j = 0; j < replacements.length; j++) {
      shifted = shifted.replace(new RegExp(replacements[j], "g"), "_");
    }
    shifted = shifted.split("_").join("");
    var step1 = atob(shifted);
    var step2 = "";
    for (var k = 0; k < step1.length; k++) {
      step2 += String.fromCharCode((step1.charCodeAt(k) - 3 + 256) % 256);
    }
    var step3 = step2.split("").reverse().join("");
    var finalText = atob(step3);
    return JSON.parse(finalText);
  } catch (e) {
    return null;
  }
}

function unpackEval(html) {
  var match = html.match(/eval\(function\(p,a,c,k,e,[rd]\)\{[\s\S]*?\}\s*\('([\s\S]*?)',\s*(\d+),\s*(\d+),\s*'([\s\S]*?)'\.split\('\|'\)/);
  if (!match) return null;
  var source = match[1];
  var radix = parseInt(match[2], 10);
  var count = parseInt(match[3], 10);
  var dictionary = match[4].split("|");
  var encodeRadix = function(num) {
    var chars = "0123456789abcdefghijklmnopqrstuvwxyz";
    var result = "";
    while (num > 0) {
      result = chars[num % radix] + result;
      num = Math.floor(num / radix);
    }
    return result || "0";
  };
  return source.replace(/\b\w+\b/g, function(word) {
    var index = parseInt(word, 36);
    if (index < dictionary.length && dictionary[index]) return dictionary[index];
    return encodeRadix(index);
  });
}

function resolveStreamWish(url) {
  return __async(null, null, function* () {
    try {
      var target = url.replace("hglink.to", "vibuxer.com");
      var originMatch = target.match(/^(https?:\/\/[^/]+)/);
      var origin = originMatch ? originMatch[1] : "https://hlswish.com";
      var response = yield fetch(target, {
        headers: {
          "User-Agent": USER_AGENT,
          "Referer": BASE_URL + "/",
          "Accept": "text/html,application/xhtml+xml"
        }
      });
      if (!response.ok) return null;
      var html = yield response.text();
      var fileMatch = html.match(/file\s*:\s*["']([^"']+)["']/i);
      if (fileMatch) {
        var streamUrl = fileMatch[1];
        if (streamUrl.startsWith("/")) streamUrl = origin + streamUrl;
        return { url: streamUrl, headers: { "User-Agent": USER_AGENT, "Referer": origin + "/" } };
      }
      var evalMatch = html.match(/eval\(function\(p,a,c,k,e,[a-z]\)\{[^}]+\}\s*\('([\s\S]+?)',\s*(\d+),\s*(\d+),\s*'([\s\S]+?)'\.split\('\|'\)/);
      if (evalMatch) {
        var unpacked = unpackEval(html);
        if (unpacked) {
          var hlsMatch = unpacked.match(/"hls[234]"\s*:\s*"([^"]+)"/) || unpacked.match(/["']([^"']{30,}\.m3u8[^"']*)['"]/i);
          if (hlsMatch) {
            var hlsUrl = hlsMatch[1];
            if (hlsUrl.startsWith("/")) hlsUrl = origin + hlsUrl;
            return { url: hlsUrl, headers: { "User-Agent": USER_AGENT, "Referer": origin + "/" } };
          }
        }
      }
      var directMatch = html.match(/https?:\/\/[^"'\s\\]+\.m3u8[^"'\s\\]*/i);
      if (directMatch) {
        return { url: directMatch[0], headers: { "User-Agent": USER_AGENT, "Referer": origin + "/" } };
      }
    } catch (e) {}
    return null;
  });
}

function resolveVidHide(url) {
  return __async(null, null, function* () {
    try {
      var response = yield fetch(url, {
        headers: { "User-Agent": USER_AGENT, "Referer": BASE_URL + "/" }
      });
      if (!response.ok) return null;
      var html = yield response.text();
      var evalBlock = html.match(/eval\(function\(p,a,c,k,e,[rd]\)[\s\S]*?\.split\('\|'\)[^\)]*\)\)/);
      if (!evalBlock) return null;
      var unpacked = unpackEval(evalBlock[0]);
      if (!unpacked) return null;
      var hlsMatch = unpacked.match(/"hls4"\s*:\s*"([^"]+)"/) || unpacked.match(/"hls2"\s*:\s*"([^"]+)"/);
      if (!hlsMatch) return null;
      var streamUrl = hlsMatch[1];
      if (!streamUrl.startsWith("http")) {
        streamUrl = new URL(url).origin + streamUrl;
      }
      return {
        url: streamUrl,
        headers: {
          "User-Agent": USER_AGENT,
          "Referer": new URL(url).origin + "/",
          "Origin": new URL(url).origin
        }
      };
    } catch (e) {}
    return null;
  });
}

function resolveGenericEmbed(url) {
  return __async(null, null, function* () {
    try {
      var response = yield fetch(url, {
        headers: { "User-Agent": USER_AGENT, "Referer": BASE_URL + "/" }
      });
      if (!response.ok) return null;
      var html = yield response.text();
      var patterns = [
        /file\s*:\s*["']([^"']+\.(?:m3u8|mp4)[^"']*)["']/i,
        /sources\s*:\s*\[["']([^"']+\.(?:m3u8|mp4)[^"']*)["']\]/i,
        /https?:\/\/[^"'\s]+\.(?:m3u8|mp4)[^"'\s]*/i
      ];
      for (var i = 0; i < patterns.length; i++) {
        var match = html.match(patterns[i]);
        if (match) {
          var streamUrl = match[1] || match[0];
          return { url: streamUrl, headers: { Referer: url, "User-Agent": USER_AGENT } };
        }
      }
    } catch (e) {}
    return null;
  });
}

function resolveEmbedUrl(url) {
  return __async(null, null, function* () {
    var resolver = getResolverForUrl(url);
    if (resolver) return yield resolver(url);
    return yield resolveGenericEmbed(url);
  });
}

function resolveVidUrlPage(vidUrl) {
  return __async(null, null, function* () {
    var html = yield fetchText(vidUrl, { Referer: BASE_URL + "/" });
    var dataLink = parseDataLink(html);
    if (!dataLink || dataLink.length === 0) return [];
    var aesKey = solvePowAndGetKey(html);
    if (!aesKey) return [];
    var streams = [];
    var seen = new Set();
    for (var langIndex = 0; langIndex < LANG_PRIORITY.length; langIndex++) {
      var langCode = LANG_PRIORITY[langIndex];
      var langBlock = null;
      for (var i = 0; i < dataLink.length; i++) {
        if ((dataLink[i].video_language || "").toUpperCase() === langCode) {
          langBlock = dataLink[i];
          break;
        }
      }
      if (!langBlock || !langBlock.sortedEmbeds) continue;
      var langLabel = langCode === "LAT" ? "Latino" : langCode === "ESP" ? "Español" : "Subtitulado";
      var embedTasks = [];
      for (var j = 0; j < langBlock.sortedEmbeds.length; j++) {
        (function(embed) {
          embedTasks.push(__async(null, null, function* () {
            if (!embed.link || embed.servername === "download") return null;
            var decrypted = decryptEmbedLink(embed.link, aesKey);
            if (!decrypted) return null;
            var resolved = yield resolveEmbedUrl(decrypted);
            if (!resolved || !resolved.url || seen.has(resolved.url)) return null;
            seen.add(resolved.url);
            var serverName = SERVER_LABELS[embed.servername] || embed.servername;
            return {
              name: "SeriesKao",
              title: "SeriesKao - " + serverName + " (" + langLabel + ")",
              url: resolved.url,
              quality: matchQuality(serverName),
              headers: Object.assign({
                "User-Agent": USER_AGENT,
                "Referer": BASE_URL + "/"
              }, resolved.headers || {}),
              provider: "serieskao"
            };
          }));
        })(langBlock.sortedEmbeds[j]);
      }
      var settled = yield Promise.allSettled(embedTasks);
      for (var s = 0; s < settled.length; s++) {
        if (settled[s].status === "fulfilled" && settled[s].value) {
          streams.push(settled[s].value);
        }
      }
      if (streams.length > 0) break;
    }
    return streams;
  });
}

function resolveServer(server) {
  return __async(null, null, function* () {
    var url = server.url;
    if (url.includes("/vidurl/")) {
      return yield resolveVidUrlPage(url);
    }
    if (/\.(m3u8|mp4)(\?|$)/i.test(url)) {
      return [{
        name: "SeriesKao",
        title: "SeriesKao - " + server.name,
        url: url,
        quality: matchQuality(server.name),
        headers: { "User-Agent": USER_AGENT, "Referer": BASE_URL + "/" },
        provider: "serieskao"
      }];
    }
    var resolved = yield resolveGenericEmbed(url);
    if (!resolved || !resolved.url) return [];
    return [{
      name: "SeriesKao",
      title: "SeriesKao - " + server.name,
      url: resolved.url,
      quality: matchQuality(server.name),
      headers: Object.assign({
        "User-Agent": USER_AGENT,
        "Referer": BASE_URL + "/"
      }, resolved.headers || {}),
      provider: "serieskao"
    }];
  });
}

function getStreams(tmdbId, mediaType, season, episode) {
  return __async(null, null, function* () {
    console.log("[SeriesKao] Fetching streams for TMDB ID: " + tmdbId + ", Type: " + mediaType);
    try {
      var imdbId = yield getImdbId(tmdbId, mediaType);
      var fallbackUrl = buildVidUrlFallback(imdbId, mediaType, season, episode);
      if (fallbackUrl) {
        console.log("[SeriesKao] Trying IMDB vidurl: " + fallbackUrl);
        var imdbStreams = yield resolveVidUrlPage(fallbackUrl);
        if (imdbStreams.length > 0) {
          console.log("[SeriesKao] Found " + imdbStreams.length + " stream(s) via IMDB.");
          return imdbStreams;
        }
      }

      var mediaInfo = yield getTMDBDetails(tmdbId, mediaType);
      mediaInfo.alternativeTitles = yield getTMDBAlternativeTitles(tmdbId, mediaType);
      console.log('[SeriesKao] Searching for: "' + mediaInfo.title + '" (' + mediaInfo.year + ")");

      var searchResults = yield searchSite(mediaInfo, mediaType);
      var match = findBestMatch(mediaInfo, searchResults, mediaType);
      var servers = [];

      if (match) {
        var watchUrl = buildWatchUrl(match, mediaType, season, episode);
        console.log("[SeriesKao] Match found: \"" + match.title + "\" -> " + watchUrl);
        var watchHtml = yield fetchText(watchUrl);
        servers = parseServers(watchHtml);
      }

      if (servers.length === 0 && fallbackUrl) {
        console.log("[SeriesKao] Using IMDB fallback servers: " + fallbackUrl);
        servers = [{ name: "Embed69", url: fallbackUrl }];
      }

      if (servers.length === 0) {
        console.log("[SeriesKao] No servers found.");
        return [];
      }

      console.log("[SeriesKao] Found " + servers.length + " server(s): " + servers.map(function(s) { return s.name; }).join(", "));

      var allStreams = [];
      var seenUrls = new Set();
      for (var i = 0; i < servers.length; i++) {
        var resolvedList = yield resolveServer(servers[i]);
        for (var j = 0; j < resolvedList.length; j++) {
          var stream = resolvedList[j];
          if (stream && stream.url && !seenUrls.has(stream.url)) {
            seenUrls.add(stream.url);
            allStreams.push(stream);
          }
        }
      }

      console.log("[SeriesKao] Successfully found " + allStreams.length + " streams.");
      return allStreams;
    } catch (error) {
      console.error("[SeriesKao] Error: " + error.message);
      return [];
    }
  });
}

module.exports = { getStreams };
if (typeof globalThis !== "undefined") globalThis.getStreams = getStreams;

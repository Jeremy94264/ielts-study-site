/* ============================================================
   speech.js — 单词朗读（Web Speech API）
   ============================================================ */
(function (global) {
  'use strict';

  var synth = global.speechSynthesis || null;
  var voices = [];
  var chosen = null;
  var settings = { rate: 0.9, volume: 1, dual: false };

  function supported() { return !!synth && typeof global.SpeechSynthesisUtterance === 'function'; }

  /* 挑选最适合朗读单词的英文音色 */
  function preferred(list) {
    if (!list.length) return null;
    var score = function (v) {
      var n = (v.name || '') + ' ' + (v.voiceURI || '');
      var s = 0;
      if (/en-GB/i.test(v.lang)) s += 50;
      else if (/en-US/i.test(v.lang)) s += 45;
      else if (/^en/i.test(v.lang)) s += 30;
      else s -= 100;
      if (/natural|neural|online/i.test(n)) s += 12;
      if (/Google/i.test(n)) s += 8;
      if (/Microsoft/i.test(n)) s += 4;
      if (/Libby|Zira|Hazel|Susan|Sonia|Samantha|Daniel|Serena|Karen|Moira|Tessa|Fiona/i.test(n)) s += 10;
      if (/Chinese|中文|Yue|Xiaoxiao|Yunxi/i.test(n)) s -= 80;
      return s;
    };
    return list.slice().sort(function (a, b) { return score(b) - score(a); })[0];
  }

  function refreshVoices() {
    if (!supported()) return [];
    voices = synth.getVoices().filter(function (v) { return /^en/i.test(v.lang || ''); });
    if (!voices.length) voices = synth.getVoices();
    if (!chosen || voices.indexOf(chosen) === -1) chosen = preferred(voices);
    return voices;
  }

  /* 音色列表可能在 voiceschanged 之后才可用 */
  if (supported()) {
    refreshVoices();
    if (typeof synth.addEventListener === 'function') {
      synth.addEventListener('voiceschanged', function () {
        refreshVoices();
        if (typeof global.__onVoicesReady === 'function') global.__onVoicesReady(voices);
      });
    } else {
      synth.onvoiceschanged = function () {
        refreshVoices();
        if (typeof global.__onVoicesReady === 'function') global.__onVoicesReady(voices);
      };
    }
  }

  function pickVoice(name) {
    if (!name) { chosen = preferred(voices.length ? voices : refreshVoices()); return chosen; }
    for (var i = 0; i < voices.length; i++) {
      if (voices[i].name === name) { chosen = voices[i]; return chosen; }
    }
    return chosen;
  }

  function utter(word, voice, rate, volume) {
    return new Promise(function (resolve) {
      var u = new global.SpeechSynthesisUtterance(word);
      if (voice) { u.voice = voice; u.lang = voice.lang; }
      else u.lang = 'en-GB';
      u.rate = rate;
      u.volume = volume;
      u.pitch = 1;
      u.onend = function () { resolve(); };
      u.onerror = function () { resolve(); };
      synth.speak(u);
      /* 兜底：某些浏览器 onend 不触发 */
      setTimeout(resolve, Math.max(900, word.length * 130 / Math.max(0.5, rate) + 400));
    });
  }

  /**
   * 朗读单词。dual=true 时先英音后美音。
   * 返回 Promise，播放结束后 resolve。
   */
  function speak(word, opts) {
    if (!supported()) return Promise.resolve(false);
    opts = opts || {};
    var rate = opts.rate != null ? opts.rate : settings.rate;
    var volume = opts.volume != null ? opts.volume : settings.volume;
    var dual = opts.dual != null ? opts.dual : settings.dual;

    /* 先取消队列里残留的内容，避免叠读 */
    try { synth.cancel(); } catch (e) {}

    if (!voices.length) refreshVoices();

    if (dual) {
      var gb = null, us = null, i;
      for (i = 0; i < voices.length; i++) {
        if (!gb && /en-GB/i.test(voices[i].lang)) gb = voices[i];
        if (!us && /en-US/i.test(voices[i].lang)) us = voices[i];
      }
      if (gb && us && gb !== us) {
        return utter(word, gb, rate, volume).then(function () {
          return new Promise(function (r) { setTimeout(r, 220); });
        }).then(function () {
          return utter(word, us, rate, volume);
        }).then(function () { return true; });
      }
    }
    return utter(word, chosen, rate, volume).then(function () { return true; });
  }

  function setSettings(s) {
    if (s.rate != null) settings.rate = s.rate;
    if (s.volume != null) settings.volume = s.volume;
    if (s.dual != null) settings.dual = s.dual;
  }

  function stop() { if (supported()) { try { synth.cancel(); } catch (e) {} } }

  global.Speech = {
    supported: supported,
    voices: function () { return voices.length ? voices : refreshVoices(); },
    pickVoice: pickVoice,
    current: function () { return chosen; },
    speak: speak,
    setSettings: setSettings,
    stop: stop
  };
})(window);

const DEMO_LESSON = {
  title: "TOEFL Listening Demo",
  source: "local-demo",
  language: "en",
  segments: [
    {
      id: "s1",
      start: 0,
      end: 4.8,
      speaker: "Narrator",
      text: "Listen to part of a lecture in an environmental science class.",
    },
    {
      id: "s2",
      start: 4.8,
      end: 10.7,
      speaker: "Professor",
      text: "Today we are going to talk about how wetlands help control flooding in nearby towns.",
    },
    {
      id: "s3",
      start: 10.7,
      end: 17.2,
      speaker: "Professor",
      text: "The key point is that the plants and soil can absorb water that would otherwise move very quickly downstream.",
    },
    {
      id: "s4",
      start: 17.2,
      end: 23.6,
      speaker: "Student",
      text: "So restoring a wetland can sometimes be cheaper than building a new concrete barrier.",
    },
  ],
};

const STORAGE_PREFIX = "listening-lab:v4:";

const state = {
  lesson: normalizeLesson(DEMO_LESSON),
  audioUrl: "",
  currentIndex: 0,
  mode: "dictation",
  hideTranscript: true,
  loopSegment: true,
  waveform: null,
  answers: {},
  submitted: {},
  playedThrough: {},
  unlockedIndex: 0,
  notes: "",
  bookmarks: [],
  library: [],
};

const els = {};

document.addEventListener("DOMContentLoaded", () => {
  bindElements();
  bindEvents();
  loadStoredState();
  loadLibrary();
  render();
  resizeWaveform();
  window.addEventListener("resize", () => {
    resizeWaveform();
    drawWaveform();
  });
});

function bindElements() {
  [
    "lessonMeta",
    "audioStatus",
    "libraryStatus",
    "audioFile",
    "transcriptFile",
    "pasteTranscript",
    "buildFromText",
    "clearSession",
    "lessonSelect",
    "refreshLibrary",
    "loadDemo",
    "exportLesson",
    "exportProgress",
    "segmentCounter",
    "waveform",
    "audio",
    "previousSegment",
    "replaySegment",
    "togglePlay",
    "nextSegment",
    "playbackRate",
    "loopSegment",
    "hideTranscript",
    "timeRange",
    "sentenceStatus",
    "scoreBadge",
    "answerText",
    "dictationInput",
    "checkAnswer",
    "revealAnswer",
    "copySegment",
    "segmentsList",
    "progressText",
    "bookmarkSegment",
    "notesInput",
    "bookmarkList",
  ].forEach((id) => {
    els[id] = document.getElementById(id);
  });
}

function bindEvents() {
  els.audioFile.addEventListener("change", handleAudioFile);
  els.transcriptFile.addEventListener("change", handleTranscriptFile);
  els.buildFromText.addEventListener("click", buildFromPastedText);
  els.clearSession.addEventListener("click", clearSession);
  els.refreshLibrary.addEventListener("click", () => loadLibrary(true));
  els.loadDemo.addEventListener("click", () => loadLesson(DEMO_LESSON));
  els.exportLesson.addEventListener("click", exportLesson);
  els.exportProgress.addEventListener("click", exportProgress);
  els.previousSegment.addEventListener("click", () => moveSegment(-1));
  els.nextSegment.addEventListener("click", () => moveSegment(1));
  els.replaySegment.addEventListener("click", () => playSegment(true));
  els.togglePlay.addEventListener("click", togglePlay);
  els.playbackRate.addEventListener("change", () => {
    els.audio.playbackRate = Number(els.playbackRate.value);
  });
  els.loopSegment.addEventListener("change", () => {
    state.loopSegment = els.loopSegment.checked;
    saveStoredState();
    render();
  });
  els.hideTranscript.addEventListener("change", () => {
    state.hideTranscript = els.hideTranscript.checked;
    saveStoredState();
    render();
  });
  document.querySelectorAll("[data-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      state.mode = button.dataset.mode;
      if (state.mode !== "dictation") {
        state.hideTranscript = false;
      }
      render();
      saveStoredState();
    });
  });
  els.audio.addEventListener("loadedmetadata", () => {
    els.audioStatus.textContent = `${formatTime(els.audio.duration)} 音频`;
    drawWaveform();
  });
  els.audio.addEventListener("timeupdate", onAudioTimeUpdate);
  els.audio.addEventListener("play", () => {
    els.togglePlay.textContent = "Ⅱ";
  });
  els.audio.addEventListener("pause", () => {
    els.togglePlay.textContent = "▶";
  });
  els.waveform.addEventListener("click", seekFromWaveform);
  els.dictationInput.addEventListener("input", () => {
    const segment = currentSegment();
    if (!segment) return;
    state.answers[segment.id] = els.dictationInput.value;
    updateScore(false);
    saveStoredState();
  });
  els.checkAnswer.addEventListener("click", submitAnswer);
  els.revealAnswer.addEventListener("click", () => {
    const segment = currentSegment();
    if (!segment || !isSubmitted(segment)) return;
    state.hideTranscript = false;
    render();
  });
  els.copySegment.addEventListener("click", copyCurrentSegment);
  els.bookmarkSegment.addEventListener("click", bookmarkCurrentSegment);
  els.notesInput.addEventListener("input", () => {
    state.notes = els.notesInput.value;
    saveStoredState();
  });
  els.lessonSelect.addEventListener("change", loadSelectedLibraryLesson);
  window.addEventListener("keydown", handleKeyboard);
}

function normalizeLesson(rawLesson) {
  const lesson = rawLesson && typeof rawLesson === "object" ? rawLesson : {};
  const rawSegments = Array.isArray(lesson.segments) ? lesson.segments : [];
  const segments = rawSegments
    .map((segment, index) => ({
      id: String(segment.id || `s${index + 1}`),
      start: toNumberOrNull(segment.start),
      end: toNumberOrNull(segment.end),
      speaker: segment.speaker || "",
      text: String(segment.text || "").trim(),
    }))
    .filter((segment) => segment.text || segment.start !== null || segment.end !== null);

  return {
    title: lesson.title || "未命名课程",
    source: lesson.source || "",
    language: lesson.language || "en",
    audioSrc: lesson.audioSrc || lesson.audio || "",
    audioFileName: lesson.audioFileName || "",
    segments,
  };
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function currentSegment() {
  return state.lesson.segments[state.currentIndex] || null;
}

function render() {
  const segment = currentSegment();
  const total = state.lesson.segments.length;
  els.lessonMeta.textContent = `${state.lesson.title} · ${total} 句`;
  els.segmentCounter.textContent = total ? `${state.currentIndex + 1} / ${total}` : "0 / 0";
  els.loopSegment.checked = state.loopSegment;
  els.hideTranscript.checked = state.hideTranscript;
  els.hideTranscript.disabled = !segment || !isSubmitted(segment);
  els.previousSegment.disabled = !segment || state.currentIndex <= 0;
  els.nextSegment.disabled = !segment || state.currentIndex >= total - 1;
  const nextIsGated = Boolean(segment && state.currentIndex < total - 1 && !canAdvanceFromCurrent());
  els.nextSegment.classList.toggle("is-gated", nextIsGated);
  els.nextSegment.dataset.gated = String(nextIsGated);
  els.nextSegment.title = nextGateMessage() || "下一句";
  els.replaySegment.disabled = !segment || !els.audio.src;
  els.togglePlay.disabled = !segment || !els.audio.src;
  els.notesInput.value = state.notes;
  document.querySelectorAll("[data-mode]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.mode === state.mode);
  });

  if (!segment) {
    els.timeRange.textContent = "--:-- - --:--";
    updateSentenceStatus(null);
    els.answerText.textContent = "暂无句段";
    els.dictationInput.value = "";
    els.scoreBadge.textContent = "未作答";
    els.revealAnswer.disabled = true;
    els.copySegment.disabled = true;
    els.previousSegment.disabled = true;
    els.nextSegment.disabled = true;
    els.nextSegment.classList.remove("is-gated");
    els.nextSegment.dataset.gated = "false";
    els.nextSegment.title = "下一句";
    els.replaySegment.disabled = true;
    els.togglePlay.disabled = true;
    renderSegments();
    renderBookmarks();
    drawWaveform();
    return;
  }

  els.timeRange.textContent = `${formatTime(segment.start)} - ${formatTime(segmentEnd(segment))}`;
  updateSentenceStatus(segment);
  els.dictationInput.value = state.answers[segment.id] || "";
  els.revealAnswer.disabled = !isSubmitted(segment);
  els.copySegment.disabled = !isSubmitted(segment);
  renderAnswerText(segment);
  renderSegments();
  renderBookmarks();
  updateScore(false);
  drawWaveform();
}

function renderAnswerText(segment) {
  const shouldHide = !isSubmitted(segment) || (state.mode === "dictation" && state.hideTranscript);
  els.answerText.classList.toggle("is-hidden", shouldHide);
  if (shouldHide) {
    els.answerText.innerHTML = maskText(segment.text);
    return;
  }
  els.answerText.textContent = segment.text || "暂无文本";
}

function maskText(text) {
  const tokens = String(text || "").split(/(\s+)/);
  return tokens
    .map((token) => {
      if (/^\s+$/.test(token)) return " ";
      if (!token) return "";
      const width = Math.max(22, Math.min(120, token.length * 11));
      return `<span class="blank-token" style="width:${width}px"></span>`;
    })
    .join("");
}

function renderSegments() {
  const segments = state.lesson.segments;
  if (!segments.length) {
    els.segmentsList.innerHTML = '<div class="empty-state">暂无句段</div>';
    els.progressText.textContent = "0%";
    return;
  }

  const answered = segments.filter((segment) => isSubmitted(segment)).length;
  els.progressText.textContent = `${Math.round((answered / segments.length) * 100)}%`;
  els.segmentsList.innerHTML = "";
  segments.forEach((segment, index) => {
    const row = document.createElement("button");
    row.type = "button";
    const selectable = canSelectSegment(index);
    const completed = isSubmitted(segment) && isPlayedThrough(segment);
    row.dataset.locked = String(!selectable);
    row.className = [
      "segment-row",
      index === state.currentIndex ? "is-active" : "",
      completed ? "is-complete" : "",
      !selectable ? "is-locked" : "",
    ]
      .filter(Boolean)
      .join(" ");
    row.innerHTML = `
      <span class="segment-index">
        <strong>${String(index + 1).padStart(2, "0")}</strong>
        <span>${formatTime(segment.start)}</span>
      </span>
      <span class="segment-preview${!isSubmitted(segment) || (state.mode === "dictation" && state.hideTranscript) ? " is-masked" : ""}">
        ${escapeHtml(!isSubmitted(segment) || (state.mode === "dictation" && state.hideTranscript) ? maskedPreview(segment.text) : segment.text || "无文本")}
      </span>
    `;
    row.addEventListener("click", () => selectSegment(index));
    els.segmentsList.appendChild(row);
  });
}

function maskedPreview(text) {
  return String(text || "")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => "·".repeat(Math.min(8, Math.max(2, word.length))))
    .join(" ");
}

function renderBookmarks() {
  if (!state.bookmarks.length) {
    els.bookmarkList.innerHTML = "";
    return;
  }
  els.bookmarkList.innerHTML = "";
  state.bookmarks.forEach((bookmark, index) => {
    const chip = document.createElement("div");
    chip.className = "bookmark-chip";
    chip.innerHTML = `<span>${escapeHtml(bookmark.label)}</span><button class="ghost-button small-button" type="button">移除</button>`;
    chip.querySelector("button").addEventListener("click", () => {
      state.bookmarks.splice(index, 1);
      saveStoredState();
      renderBookmarks();
    });
    chip.addEventListener("dblclick", () => selectSegment(bookmark.index));
    els.bookmarkList.appendChild(chip);
  });
}

async function handleAudioFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  if (state.audioUrl) URL.revokeObjectURL(state.audioUrl);
  state.audioUrl = URL.createObjectURL(file);
  state.lesson.audioFileName = file.name;
  state.lesson.audioSrc = "";
  els.audio.src = state.audioUrl;
  els.audio.playbackRate = Number(els.playbackRate.value);
  els.audioStatus.textContent = file.name;
  await decodeWaveform(file);
  render();
}

async function decodeWaveform(fileOrUrl) {
  try {
    const arrayBuffer =
      typeof fileOrUrl === "string"
        ? await fetch(fileOrUrl).then((response) => response.arrayBuffer())
        : await fileOrUrl.arrayBuffer();
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      state.waveform = null;
      drawWaveform();
      return;
    }
    const context = new AudioContextClass();
    const audioBuffer = await context.decodeAudioData(arrayBuffer.slice(0));
    state.waveform = makePeaks(audioBuffer);
    await context.close();
  } catch (error) {
    state.waveform = null;
  }
  drawWaveform();
}

function makePeaks(audioBuffer) {
  const sampleCount = audioBuffer.length;
  const channel = audioBuffer.getChannelData(0);
  const points = 1200;
  const blockSize = Math.max(1, Math.floor(sampleCount / points));
  const peaks = [];
  for (let i = 0; i < points; i += 1) {
    const start = i * blockSize;
    const end = Math.min(start + blockSize, sampleCount);
    let peak = 0;
    for (let j = start; j < end; j += 1) {
      peak = Math.max(peak, Math.abs(channel[j]));
    }
    peaks.push(peak);
  }
  return { peaks, duration: audioBuffer.duration };
}

function resizeWaveform() {
  const canvas = els.waveform;
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(320, Math.floor(rect.width * ratio));
  canvas.height = Math.floor(160 * ratio);
}

function drawWaveform() {
  const canvas = els.waveform;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const ratio = window.devicePixelRatio || 1;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#f8fafc";
  ctx.fillRect(0, 0, width, height);

  const duration = getKnownDuration();
  const active = currentSegment();
  const activeEnd = segmentEnd(active);
  if (active && duration && active.start !== null && activeEnd !== null) {
    const startX = (active.start / duration) * width;
    const endX = (activeEnd / duration) * width;
    ctx.fillStyle = "rgba(15, 118, 110, 0.13)";
    ctx.fillRect(startX, 0, Math.max(3 * ratio, endX - startX), height);
  }

  const peaks = state.waveform?.peaks || [];
  ctx.strokeStyle = peaks.length ? "#2563eb" : "#aab8c5";
  ctx.lineWidth = Math.max(1, ratio);
  const midY = height / 2;
  if (peaks.length) {
    const step = Math.max(1, Math.floor(peaks.length / width));
    for (let x = 0; x < width; x += 2 * ratio) {
      const peakIndex = Math.min(peaks.length - 1, Math.floor((x / width) * peaks.length));
      let peak = 0;
      for (let p = peakIndex; p < Math.min(peaks.length, peakIndex + step); p += 1) {
        peak = Math.max(peak, peaks[p]);
      }
      const bar = Math.max(2 * ratio, peak * height * 0.76);
      ctx.beginPath();
      ctx.moveTo(x, midY - bar / 2);
      ctx.lineTo(x, midY + bar / 2);
      ctx.stroke();
    }
  } else {
    ctx.setLineDash([8 * ratio, 10 * ratio]);
    ctx.beginPath();
    ctx.moveTo(20 * ratio, midY);
    ctx.lineTo(width - 20 * ratio, midY);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  const progress = duration ? (els.audio.currentTime / duration) * width : 0;
  ctx.fillStyle = "rgba(180, 83, 9, 0.9)";
  ctx.fillRect(Math.max(0, progress - 1 * ratio), 0, 2 * ratio, height);
}

function getKnownDuration() {
  if (Number.isFinite(els.audio.duration) && els.audio.duration > 0) return els.audio.duration;
  if (state.waveform?.duration) return state.waveform.duration;
  const ends = state.lesson.segments.map((segment) => segment.end || 0);
  return Math.max(0, ...ends);
}

async function handleTranscriptFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  const text = await file.text();
  const parsedLesson = parseTranscript(file.name, text);
  loadLesson({
    ...state.lesson,
    title: parsedLesson.title,
    segments: parsedLesson.segments,
  });
}

function buildFromPastedText() {
  const text = els.pasteTranscript.value.trim();
  if (!text) return;
  const parsedLesson = {
    title: state.lesson.title === DEMO_LESSON.title ? "粘贴文稿课程" : state.lesson.title,
    segments: segmentsFromPlainText(text, getKnownDuration()),
  };
  loadLesson({ ...state.lesson, ...parsedLesson });
}

function parseTranscript(fileName, text) {
  const trimmed = text.trim();
  if (!trimmed) return { title: fileBaseName(fileName), segments: [] };
  if (/\.json$/i.test(fileName) || /^[\[{]/.test(trimmed)) {
    try {
      const payload = JSON.parse(trimmed);
      if (Array.isArray(payload)) {
        return { title: fileBaseName(fileName), segments: normalizeLesson({ segments: payload }).segments };
      }
      if (payload.sections) {
        return lessonFromLegacyManifest(payload, fileBaseName(fileName));
      }
      return normalizeLesson({ title: payload.title || fileBaseName(fileName), ...payload });
    } catch (error) {
      return { title: fileBaseName(fileName), segments: segmentsFromPlainText(trimmed, getKnownDuration()) };
    }
  }
  if (trimmed.includes("-->")) {
    return { title: fileBaseName(fileName), segments: segmentsFromTimedText(trimmed) };
  }
  return { title: fileBaseName(fileName), segments: segmentsFromPlainText(trimmed, getKnownDuration()) };
}

function lessonFromLegacyManifest(payload, fallbackTitle) {
  const listening = (payload.sections || []).find((section) => section.type === "listening");
  const segments = [];
  (listening?.items || []).forEach((item, index) => {
    const start = toNumberOrNull(item.start_time);
    const end = toNumberOrNull(item.end_time);
    segments.push({
      id: `set${index + 1}`,
      start,
      end,
      speaker: "",
      text: item.title || `Listening set ${index + 1}`,
    });
  });
  return { title: fallbackTitle, segments };
}

function segmentsFromTimedText(text) {
  const blocks = text
    .replace(/\r/g, "")
    .replace(/^WEBVTT.*\n/i, "")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
  const segments = [];
  blocks.forEach((block) => {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    const timingIndex = lines.findIndex((line) => line.includes("-->"));
    if (timingIndex === -1) return;
    const [startRaw, endRaw] = lines[timingIndex].split("-->").map((part) => part.trim().split(/\s+/)[0]);
    const body = lines.slice(timingIndex + 1).join(" ").trim();
    if (!body) return;
    segments.push({
      id: `s${segments.length + 1}`,
      start: parseTimestamp(startRaw),
      end: parseTimestamp(endRaw),
      speaker: "",
      text: body,
    });
  });
  return normalizeLesson({ segments }).segments;
}

function segmentsFromPlainText(text, duration) {
  const lines = text
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const units = lines.length > 1 ? lines : splitSentences(text);
  const usable = units.map((line) => line.trim()).filter(Boolean);
  const hasDuration = Number.isFinite(duration) && duration > 0 && usable.length > 0;
  const chunk = hasDuration ? duration / usable.length : null;
  return usable.map((line, index) => ({
    id: `s${index + 1}`,
    start: chunk === null ? null : roundTime(index * chunk),
    end: chunk === null ? null : roundTime((index + 1) * chunk),
    speaker: "",
    text: line,
  }));
}

function splitSentences(text) {
  const output = [];
  let buffer = "";
  for (const char of text.replace(/\s+/g, " ").trim()) {
    buffer += char;
    if (".!?。！？".includes(char) && buffer.trim().length > 0) {
      output.push(buffer.trim());
      buffer = "";
    }
  }
  if (buffer.trim()) output.push(buffer.trim());
  return output.length ? output : [text.trim()];
}

function parseTimestamp(value) {
  const normalized = value.replace(",", ".");
  const parts = normalized.split(":");
  let seconds = 0;
  parts.forEach((part) => {
    seconds = seconds * 60 + Number(part);
  });
  return Number.isFinite(seconds) ? roundTime(seconds) : null;
}

function roundTime(value) {
  return Math.round(value * 100) / 100;
}

function fileBaseName(name) {
  return String(name || "未命名课程").replace(/\.[^.]+$/, "");
}

async function loadSelectedLibraryLesson() {
  const path = els.lessonSelect.value;
  if (!path) return;
  try {
    const lesson = await fetch(path, { cache: "no-store" }).then((response) => response.json());
    await loadLesson(lesson, path);
  } catch (error) {
    els.audioStatus.textContent = "课包加载失败";
  }
}

async function loadLesson(rawLesson, basePath = "") {
  state.lesson = normalizeLesson(rawLesson);
  state.currentIndex = 0;
  state.answers = {};
  state.submitted = {};
  state.playedThrough = {};
  state.unlockedIndex = 0;
  state.notes = "";
  state.bookmarks = [];
  els.pasteTranscript.value = "";
  if (state.lesson.audioSrc && basePath) {
    const resolved = new URL(state.lesson.audioSrc, new URL(basePath, window.location.href)).toString();
    els.audio.src = resolved;
    els.audioStatus.textContent = state.lesson.audioFileName || "已关联音频";
    await decodeWaveform(resolved);
  } else if (!state.lesson.audioSrc && !state.audioUrl) {
    els.audioStatus.textContent = "未加载音频";
  }
  loadStoredState();
  render();
  saveStoredState();
}

async function loadLibrary(forceReload = false) {
  try {
    const library = await fetch("./library.json", { cache: "no-store" }).then((response) => {
      if (!response.ok) throw new Error("no library");
      return response.json();
    });
    state.library = Array.isArray(library.lessons) ? library.lessons : [];
    if (!state.library.length) {
      els.libraryStatus.textContent = "暂无课包";
      els.lessonSelect.disabled = true;
      els.lessonSelect.innerHTML = '<option value="">暂无课包</option>';
      return;
    }
    els.lessonSelect.disabled = false;
    els.lessonSelect.innerHTML = '<option value="">选择课包</option>';
    state.library.forEach((lesson) => {
      const option = document.createElement("option");
      option.value = lesson.path;
      option.textContent = lesson.title || lesson.path;
      els.lessonSelect.appendChild(option);
    });
    els.libraryStatus.textContent = `${state.library.length} 个课包`;
    if (forceReload || state.lesson.title === DEMO_LESSON.title || state.lesson.segments.length === 0) {
      els.lessonSelect.value = state.library[0].path;
      await loadSelectedLibraryLesson();
    }
  } catch (error) {
    state.library = [];
    els.libraryStatus.textContent = "等待课包";
    els.lessonSelect.disabled = true;
    els.lessonSelect.innerHTML = '<option value="">暂无课包</option>';
  }
}

function clearSession() {
  const previousKey = storageKey();
  state.lesson = normalizeLesson({ title: "空白课程", segments: [] });
  state.currentIndex = 0;
  state.answers = {};
  state.submitted = {};
  state.playedThrough = {};
  state.unlockedIndex = 0;
  state.notes = "";
  state.bookmarks = [];
  state.waveform = null;
  els.audio.removeAttribute("src");
  els.audioStatus.textContent = "未加载音频";
  els.pasteTranscript.value = "";
  localStorage.removeItem(previousKey);
  render();
}

function selectSegment(index) {
  const nextIndex = Math.max(0, Math.min(index, state.lesson.segments.length - 1));
  if (!canSelectSegment(nextIndex)) {
    showGateMessage();
    render();
    return false;
  }
  state.currentIndex = nextIndex;
  state.unlockedIndex = Math.max(state.unlockedIndex, nextIndex);
  setAudioToSegmentStart();
  els.audio.pause();
  render();
  saveStoredState();
  return true;
}

function moveSegment(delta) {
  selectSegment(state.currentIndex + delta);
}

async function playSegment(restart) {
  const segment = currentSegment();
  if (!segment || !els.audio.src) return;
  if (restart || isFiniteNumber(segment.start)) {
    els.audio.currentTime = Math.max(0, segment.start || 0);
  }
  await safePlay();
}

async function togglePlay() {
  if (!els.audio.src) return;
  if (els.audio.paused) {
    ensureAudioWithinCurrentSegment();
    await safePlay();
  } else {
    els.audio.pause();
  }
}

async function safePlay() {
  try {
    await els.audio.play();
  } catch (error) {
    els.audioStatus.textContent = "浏览器阻止了自动播放";
  }
}

function onAudioTimeUpdate() {
  const segment = currentSegment();
  const end = segmentEnd(segment);
  if (!segment || !isFiniteNumber(end)) {
    drawWaveform();
    return;
  }

  if (els.audio.currentTime >= end - 0.35) {
    markSegmentPlayedThrough(segment);
    if (state.loopSegment) {
      els.audio.currentTime = Math.max(0, segment.start || 0);
      safePlay();
    } else {
      els.audio.pause();
      els.audio.currentTime = end;
    }
    drawWaveform();
    return;
  }

  drawWaveform();
}

function seekFromWaveform(event) {
  const duration = getKnownDuration();
  if (!duration || !els.audio.src) return;
  const rect = els.waveform.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
  let targetTime = ratio * duration;
  const segment = currentSegment();
  const end = segmentEnd(segment);
  if (segment && isFiniteNumber(segment.start) && isFiniteNumber(end)) {
    targetTime = Math.max(segment.start, Math.min(end, targetTime));
  }
  els.audio.currentTime = targetTime;
  drawWaveform();
}

function updateScore(forceReveal) {
  const segment = currentSegment();
  if (!segment) return;
  const value = els.dictationInput.value;
  if (!isSubmitted(segment)) {
    els.scoreBadge.className = "score-badge";
    els.scoreBadge.textContent = value.trim() ? "未提交" : "未作答";
    return;
  }
  if (!value.trim()) {
    els.scoreBadge.className = "score-badge";
    els.scoreBadge.textContent = "未作答";
    return;
  }
  const score = scoreAnswer(segment.text, value);
  els.scoreBadge.textContent = `${score}%`;
  els.scoreBadge.className = "score-badge";
  if (score >= 85) els.scoreBadge.classList.add("is-high");
  else if (score >= 60) els.scoreBadge.classList.add("is-mid");
  else els.scoreBadge.classList.add("is-low");
  if (forceReveal) {
    state.hideTranscript = false;
    renderAnswerText(segment);
  }
}

function submitAnswer() {
  const segment = currentSegment();
  if (!segment) return;
  const value = els.dictationInput.value.trim();
  if (!value) {
    els.scoreBadge.className = "score-badge";
    els.scoreBadge.textContent = "请先输入";
    return;
  }
  state.answers[segment.id] = els.dictationInput.value;
  state.submitted[segment.id] = true;
  state.hideTranscript = true;
  updateScore(false);
  if (canAdvanceFromCurrent()) {
    els.audioStatus.textContent = "本句完成，可以进入下一句";
  } else {
    els.audioStatus.textContent = "答案已提交，请继续播放到本句结束";
  }
  render();
  saveStoredState();
}

function isSubmitted(segment) {
  return Boolean(segment && state.submitted[segment.id]);
}

function isPlayedThrough(segment) {
  return Boolean(segment && state.playedThrough[segment.id]);
}

function markSegmentPlayedThrough(segment) {
  if (!segment || state.playedThrough[segment.id]) return;
  state.playedThrough[segment.id] = true;
  els.audioStatus.textContent = isSubmitted(segment) ? "本句完成，可以进入下一句" : "已听到本句结束，请提交答案";
  render();
  saveStoredState();
}

function updateSentenceStatus(segment) {
  if (!els.sentenceStatus) return;
  if (!segment) {
    els.sentenceStatus.textContent = "待开始";
    els.sentenceStatus.dataset.state = "idle";
    return;
  }
  const heard = isPlayedThrough(segment) || !isFiniteNumber(segmentEnd(segment));
  const submitted = isSubmitted(segment);
  if (heard && submitted) {
    els.sentenceStatus.textContent = "已听完 · 已提交";
    els.sentenceStatus.dataset.state = "done";
  } else if (heard) {
    els.sentenceStatus.textContent = "已听完 · 待提交";
    els.sentenceStatus.dataset.state = "heard";
  } else if (submitted) {
    els.sentenceStatus.textContent = "已提交 · 待听完";
    els.sentenceStatus.dataset.state = "submitted";
  } else {
    els.sentenceStatus.textContent = "待听完 · 待提交";
    els.sentenceStatus.dataset.state = "pending";
  }
}

function canAdvanceFromCurrent() {
  const segment = currentSegment();
  if (!segment) return false;
  const hasKnownEnd = isFiniteNumber(segmentEnd(segment));
  return isSubmitted(segment) && (isPlayedThrough(segment) || !hasKnownEnd);
}

function canSelectSegment(index) {
  if (!state.lesson.segments.length) return false;
  if (index === state.currentIndex) return true;
  if (index <= state.unlockedIndex) return true;
  return index === state.unlockedIndex + 1 && state.currentIndex === state.unlockedIndex && canAdvanceFromCurrent();
}

function showGateMessage() {
  const message = nextGateMessage();
  if (message) els.audioStatus.textContent = message;
}

function nextGateMessage() {
  const segment = currentSegment();
  if (!segment || canAdvanceFromCurrent()) return "";
  const heard = isPlayedThrough(segment) || !isFiniteNumber(segmentEnd(segment));
  if (!heard && !isSubmitted(segment)) return "下一句锁定：请先听完整句并提交答案";
  if (!heard) return "下一句锁定：请先听到本句结束";
  if (!isSubmitted(segment)) return "下一句锁定：请先提交本句答案";
  return "";
}

function ensureAudioWithinCurrentSegment() {
  const segment = currentSegment();
  if (!segment) return;
  const start = isFiniteNumber(segment.start) ? segment.start : 0;
  const end = segmentEnd(segment);
  if (els.audio.currentTime < start || (isFiniteNumber(end) && els.audio.currentTime >= end - 0.04)) {
    els.audio.currentTime = start;
  }
}

function setAudioToSegmentStart() {
  const segment = currentSegment();
  if (!segment || !els.audio.src || !isFiniteNumber(segment.start)) return;
  els.audio.currentTime = Math.max(0, segment.start || 0);
}

function segmentEnd(segment) {
  if (!segment) return null;
  if (isFiniteNumber(segment.end)) return Number(segment.end);
  const segmentIndex = state.lesson.segments.findIndex((candidate) => candidate.id === segment.id);
  const next = state.lesson.segments[segmentIndex + 1];
  if (next && isFiniteNumber(next.start)) return Number(next.start);
  const duration = getMediaDuration();
  if (duration && (!isFiniteNumber(segment.start) || duration > Number(segment.start))) return duration;
  return null;
}

function getMediaDuration() {
  if (Number.isFinite(els.audio.duration) && els.audio.duration > 0) return els.audio.duration;
  if (state.waveform?.duration) return state.waveform.duration;
  return 0;
}

function scoreAnswer(reference, answer) {
  const ref = normalizeText(reference).split(" ").filter(Boolean);
  const hyp = normalizeText(answer).split(" ").filter(Boolean);
  if (!ref.length) return 0;
  const distance = levenshtein(ref, hyp);
  return Math.max(0, Math.round((1 - distance / ref.length) * 100));
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a, b) {
  const dp = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i += 1) dp[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) dp[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[a.length][b.length];
}

async function copyCurrentSegment() {
  const segment = currentSegment();
  if (!segment) return;
  if (!isSubmitted(segment)) return;
  try {
    await navigator.clipboard.writeText(segment.text);
  } catch (error) {
    els.dictationInput.value = segment.text;
  }
}

function bookmarkCurrentSegment() {
  const segment = currentSegment();
  if (!segment) return;
  const label = `${String(state.currentIndex + 1).padStart(2, "0")} · ${formatTime(segment.start)}`;
  if (!state.bookmarks.some((bookmark) => bookmark.index === state.currentIndex)) {
    state.bookmarks.push({ index: state.currentIndex, id: segment.id, label });
    saveStoredState();
    renderBookmarks();
  }
}

function exportLesson() {
  const lesson = {
    ...state.lesson,
    exportedAt: new Date().toISOString(),
  };
  downloadJson(`${slugify(state.lesson.title)}-lesson.json`, lesson);
}

function exportProgress() {
  const progress = {
    lessonTitle: state.lesson.title,
    exportedAt: new Date().toISOString(),
    answers: state.answers,
    submitted: state.submitted,
    playedThrough: state.playedThrough,
    unlockedIndex: state.unlockedIndex,
    notes: state.notes,
    bookmarks: state.bookmarks,
    scores: state.lesson.segments.map((segment, index) => ({
      index: index + 1,
      segmentId: segment.id,
      score: state.answers[segment.id] ? scoreAnswer(segment.text, state.answers[segment.id]) : null,
    })),
  };
  downloadJson(`${slugify(state.lesson.title)}-progress.json`, progress);
}

function downloadJson(fileName, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function loadStoredState() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey()) || "{}");
    state.answers = saved.answers || {};
    state.submitted = saved.submitted || {};
    state.playedThrough = saved.playedThrough || {};
    const savedUnlockedIndex = Number.isInteger(saved.unlockedIndex) ? saved.unlockedIndex : 0;
    state.unlockedIndex = Math.max(0, Math.min(savedUnlockedIndex, Math.max(0, state.lesson.segments.length - 1)));
    state.notes = saved.notes || "";
    state.bookmarks = Array.isArray(saved.bookmarks) ? saved.bookmarks : [];
    state.hideTranscript = saved.hideTranscript ?? state.hideTranscript;
    state.loopSegment = saved.loopSegment ?? state.loopSegment;
    state.mode = saved.mode || state.mode;
  } catch (error) {
    state.answers = {};
    state.submitted = {};
    state.playedThrough = {};
    state.unlockedIndex = 0;
    state.notes = "";
    state.bookmarks = [];
  }
}

function saveStoredState() {
  localStorage.setItem(
    storageKey(),
    JSON.stringify({
      answers: state.answers,
      submitted: state.submitted,
      playedThrough: state.playedThrough,
      unlockedIndex: state.unlockedIndex,
      notes: state.notes,
      bookmarks: state.bookmarks,
      hideTranscript: state.hideTranscript,
      loopSegment: state.loopSegment,
      mode: state.mode,
    }),
  );
}

function storageKey() {
  const text = state.lesson.segments.map((segment) => segment.text).join("|");
  return `${STORAGE_PREFIX}${slugify(state.lesson.title)}:${simpleHash(text)}`;
}

function simpleHash(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16);
}

function slugify(value) {
  return String(value || "lesson")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "lesson";
}

function formatTime(value) {
  if (!isFiniteNumber(value)) return "--:--";
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function isFiniteNumber(value) {
  return Number.isFinite(Number(value));
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function handleKeyboard(event) {
  if (event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement) return;
  if (event.code === "Space") {
    event.preventDefault();
    togglePlay();
  } else if (event.code === "ArrowLeft") {
    moveSegment(-1);
  } else if (event.code === "ArrowRight") {
    moveSegment(1);
  } else if (event.code === "KeyR") {
    playSegment(true);
  }
}

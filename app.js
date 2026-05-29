const APP_VERSION = "20260529-lms-2";
const STORAGE_PREFIX = "listening-lab-lms:v1:";
const MAX_PRE_SUBMIT_LISTENS = 3;

const state = {
  configReady: false,
  supabase: null,
  session: null,
  profile: null,
  library: [],
  students: [],
  teacherAssignments: [],
  teacherProgressRows: [],
  selectedTeacherAssignmentId: "",
  studentAssignments: [],
  studentProgressRows: [],
  assignment: null,
  lesson: normalizeLesson({ title: "未选择任务", segments: [] }),
  lessonPath: "",
  lessonUrl: "",
  currentIndex: 0,
  answers: {},
  submitted: {},
  playedThrough: {},
  listenCounts: {},
  scores: {},
  submittedAt: {},
  unlockedIndex: 0,
  notes: "",
  waveform: null,
  activeListenSegmentId: "",
  saving: false,
  pendingSaveSegmentId: "",
};

const els = {};
let cloudSaveTimer = null;

const lessonRepository = {
  async list() {
    const response = await fetch(`./library.json?v=${APP_VERSION}`, { cache: "no-store" });
    if (!response.ok) throw new Error("library not found");
    const library = await response.json();
    return Array.isArray(library.lessons) ? library.lessons : [];
  },
  async load(path) {
    const response = await fetch(path, { cache: "no-store" });
    if (!response.ok) throw new Error("lesson not found");
    return response.json();
  },
};

document.addEventListener("DOMContentLoaded", async () => {
  bindElements();
  bindEvents();
  initializeSupabase();
  await loadLibrary();
  await initializeAuth();
  renderShell();
  resizeWaveform();
  window.addEventListener("resize", () => {
    resizeWaveform();
    drawWaveform();
  });
});

function bindElements() {
  [
    "appStatus",
    "userBadge",
    "signOutButton",
    "authView",
    "appView",
    "configStatus",
    "authStatus",
    "fullNameInput",
    "emailInput",
    "passwordInput",
    "signInButton",
    "signUpButton",
    "studentTasksPanel",
    "assignmentCount",
    "assignmentList",
    "practicePanel",
    "lessonMeta",
    "segmentCounter",
    "syncStatus",
    "waveform",
    "audio",
    "previousSegment",
    "replaySegment",
    "togglePlay",
    "nextSegment",
    "playbackRate",
    "timeRange",
    "sentenceStatus",
    "listenCountBadge",
    "scoreBadge",
    "answerText",
    "dictationInput",
    "checkAnswer",
    "copySegment",
    "audioStatus",
    "progressPanel",
    "progressText",
    "progressSummary",
    "notesInput",
    "teacherPanel",
    "teacherStatus",
    "studentSelect",
    "teacherLessonSelect",
    "dueAtInput",
    "assignmentNote",
    "assignTaskButton",
    "studentsList",
    "refreshTeacherData",
    "teacherAssignments",
    "teacherProgress",
  ].forEach((id) => {
    els[id] = document.getElementById(id);
  });
}

function bindEvents() {
  on(els.signInButton, "click", signIn);
  on(els.signUpButton, "click", signUp);
  on(els.signOutButton, "click", signOut);
  on(els.assignTaskButton, "click", assignTask);
  on(els.refreshTeacherData, "click", loadTeacherDashboard);
  on(els.previousSegment, "click", () => moveSegment(-1));
  on(els.nextSegment, "click", () => moveSegment(1));
  on(els.replaySegment, "click", () => playCurrentSegment(true));
  on(els.togglePlay, "click", togglePlay);
  on(els.playbackRate, "change", () => {
    els.audio.playbackRate = Number(els.playbackRate.value);
  });
  on(els.waveform, "click", seekFromWaveform);
  on(els.audio, "loadedmetadata", () => {
    setAudioStatus(`${formatTime(els.audio.duration)} 音频已就绪`);
    drawWaveform();
  });
  on(els.audio, "timeupdate", onAudioTimeUpdate);
  on(els.audio, "play", () => {
    els.togglePlay.textContent = "Ⅱ";
  });
  on(els.audio, "pause", () => {
    els.togglePlay.textContent = "▶";
  });
  on(els.dictationInput, "input", () => {
    const segment = currentSegment();
    if (!segment || isSubmitted(segment)) return;
    state.answers[segment.id] = els.dictationInput.value;
    saveLocalProgress();
    scheduleCloudSave(segment);
    updateScoreBadge(segment);
  });
  on(els.dictationInput, "paste", (event) => {
    const segment = currentSegment();
    if (isStudent() && segment && !isSubmitted(segment)) {
      event.preventDefault();
      setAudioStatus("提交前不能粘贴答案");
    }
  });
  on(els.answerText, "copy", (event) => {
    const segment = currentSegment();
    if (!segment || !isSubmitted(segment)) {
      event.preventDefault();
    }
  });
  on(els.checkAnswer, "click", submitAnswer);
  on(els.copySegment, "click", copyCurrentSegment);
  on(els.notesInput, "input", () => {
    state.notes = els.notesInput.value;
    saveLocalProgress();
    scheduleCloudSave(null);
  });
  window.addEventListener("keydown", handleKeyboard);
}

function on(element, eventName, handler) {
  if (element) element.addEventListener(eventName, handler);
}

function initializeSupabase() {
  const config = window.LISTENING_LAB_SUPABASE || {};
  const hasClient = Boolean(window.supabase && window.supabase.createClient);
  const hasConfig = isFilledSupabaseConfig(config);
  state.configReady = hasClient && hasConfig;

  if (!hasClient) {
    setConfigStatus("Supabase SDK 加载失败", "danger");
    return;
  }
  if (!hasConfig) {
    setConfigStatus("请先填写 supabase-config.js", "warning");
    return;
  }

  state.supabase = window.supabase.createClient(config.url, config.anonKey);
  setConfigStatus("Supabase 已连接", "");
}

function isFilledSupabaseConfig(config) {
  return (
    typeof config.url === "string" &&
    config.url.startsWith("https://") &&
    typeof config.anonKey === "string" &&
    config.anonKey.length > 30 &&
    !config.anonKey.includes("YOUR_")
  );
}

function setConfigStatus(text, tone) {
  els.configStatus.textContent = text;
  els.configStatus.className = "status-pill";
  if (tone) els.configStatus.classList.add(`is-${tone}`);
}

async function initializeAuth() {
  if (!state.supabase) {
    setAuthStatus("Supabase 未配置，先按文档创建项目并填写 anon key。");
    disableAuthControls(true);
    return;
  }

  const { data, error } = await state.supabase.auth.getSession();
  if (error) setAuthStatus(error.message);
  state.session = data?.session || null;

  state.supabase.auth.onAuthStateChange((_event, session) => {
    state.session = session;
    handleSessionChanged();
  });

  await handleSessionChanged();
}

async function signIn() {
  if (!state.supabase) return;
  const email = els.emailInput.value.trim();
  const password = els.passwordInput.value;
  if (!email || !password) {
    setAuthStatus("请输入邮箱和密码。");
    return;
  }
  setAuthStatus("登录中...");
  const { error } = await state.supabase.auth.signInWithPassword({ email, password });
  if (error) setAuthStatus(error.message);
}

async function signUp() {
  if (!state.supabase) return;
  const email = els.emailInput.value.trim();
  const password = els.passwordInput.value;
  const fullName = els.fullNameInput.value.trim();
  if (!email || !password) {
    setAuthStatus("请输入邮箱和密码。");
    return;
  }
  setAuthStatus("注册中...");
  const { data, error } = await state.supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName } },
  });
  if (error) {
    setAuthStatus(error.message);
    return;
  }
  if (!data.session) {
    setAuthStatus("注册成功。若开启了邮箱确认，请先去邮箱完成确认。");
  }
}

async function signOut() {
  if (!state.supabase) return;
  await state.supabase.auth.signOut();
}

async function handleSessionChanged() {
  if (!state.session) {
    resetUserState();
    renderShell();
    return;
  }

  try {
    state.profile = await ensureProfile();
    if (isTeacher()) {
      await loadTeacherDashboard();
    } else {
      await loadStudentAssignments();
    }
  } catch (error) {
    setAuthStatus(`账号数据加载失败：${error.message}`);
  }
  renderShell();
}

function resetUserState() {
  state.profile = null;
  state.students = [];
  state.teacherAssignments = [];
  state.teacherProgressRows = [];
  state.studentAssignments = [];
  state.studentProgressRows = [];
  state.assignment = null;
  clearPracticeData();
}

async function ensureProfile() {
  const user = state.session.user;
  const { data, error } = await state.supabase
    .from("profiles")
    .select("id,email,full_name,role,created_at")
    .eq("id", user.id)
    .maybeSingle();
  if (error) throw error;
  if (data) return data;

  const fallbackName = user.user_metadata?.full_name || user.email?.split("@")[0] || "Student";
  const { error: insertError } = await state.supabase.from("profiles").insert({
    id: user.id,
    email: user.email,
    full_name: fallbackName,
    role: "student",
  });
  if (insertError && insertError.code !== "23505") throw insertError;

  const { data: created, error: fetchError } = await state.supabase
    .from("profiles")
    .select("id,email,full_name,role,created_at")
    .eq("id", user.id)
    .single();
  if (fetchError) throw fetchError;
  return created;
}

async function loadLibrary() {
  try {
    state.library = await lessonRepository.list();
  } catch (error) {
    state.library = [];
  }
  renderTeacherLessonOptions();
}

async function loadTeacherDashboard() {
  if (!isTeacher()) return;
  els.teacherStatus.textContent = "加载中...";
  const [studentsResult, assignmentsResult] = await Promise.all([
    state.supabase.from("profiles").select("id,email,full_name,created_at").eq("role", "student").order("created_at"),
    state.supabase
      .from("assignments")
      .select("*")
      .eq("teacher_id", state.session.user.id)
      .order("created_at", { ascending: false }),
  ]);

  if (studentsResult.error) throw studentsResult.error;
  if (assignmentsResult.error) throw assignmentsResult.error;

  state.students = studentsResult.data || [];
  state.teacherAssignments = assignmentsResult.data || [];
  await loadTeacherProgressRows();
  if (!state.selectedTeacherAssignmentId && state.teacherAssignments.length) {
    state.selectedTeacherAssignmentId = state.teacherAssignments[0].id;
  }
  renderTeacherDashboard();
}

async function loadTeacherProgressRows() {
  const ids = state.teacherAssignments.map((assignment) => assignment.id);
  if (!ids.length) {
    state.teacherProgressRows = [];
    return;
  }
  const { data, error } = await state.supabase
    .from("segment_progress")
    .select("*")
    .in("assignment_id", ids)
    .order("segment_index", { ascending: true });
  if (error) throw error;
  state.teacherProgressRows = data || [];
}

async function assignTask() {
  if (!isTeacher()) return;
  const studentId = els.studentSelect.value;
  const lessonPath = els.teacherLessonSelect.value;
  const lessonMeta = state.library.find((lesson) => lesson.path === lessonPath);
  if (!studentId || !lessonMeta) {
    els.teacherStatus.textContent = "请选择学生和课包";
    return;
  }

  els.teacherStatus.textContent = "正在分配...";
  try {
    const rawLesson = await lessonRepository.load(lessonPath);
    const lesson = normalizeLesson(rawLesson);
    const dueAt = els.dueAtInput.value ? new Date(els.dueAtInput.value).toISOString() : null;
    const { error } = await state.supabase.from("assignments").insert({
      teacher_id: state.session.user.id,
      student_id: studentId,
      lesson_title: lesson.title || lessonMeta.title,
      lesson_path: lessonPath,
      lesson_segment_count: lesson.segments.length,
      due_at: dueAt,
      note: els.assignmentNote.value.trim() || null,
      source_type: "static_lesson",
      content_ref: {
        path: lessonPath,
        title: lesson.title || lessonMeta.title,
        futureItemType: "sentence_item_set",
      },
    });
    if (error) throw error;
    els.assignmentNote.value = "";
    els.teacherStatus.textContent = "任务已分配";
    await loadTeacherDashboard();
  } catch (error) {
    els.teacherStatus.textContent = `分配失败：${error.message}`;
  }
}

async function loadStudentAssignments() {
  if (!isStudent()) return;
  const { data, error } = await state.supabase
    .from("assignments")
    .select("*")
    .eq("student_id", state.session.user.id)
    .order("created_at", { ascending: false });
  if (error) throw error;

  state.studentAssignments = data || [];
  await loadStudentProgressRows();
  renderStudentAssignments();

  if (!state.studentAssignments.length) {
    state.assignment = null;
    clearPracticeData();
    renderPractice();
    return;
  }

  const savedId = localStorage.getItem(selectedAssignmentKey());
  const nextAssignment =
    state.studentAssignments.find((assignment) => assignment.id === savedId) ||
    state.studentAssignments.find((assignment) => assignmentProgressPercent(assignment) < 100) ||
    state.studentAssignments[0];
  await selectStudentAssignment(nextAssignment.id);
}

async function loadStudentProgressRows() {
  const ids = state.studentAssignments.map((assignment) => assignment.id);
  if (!ids.length) {
    state.studentProgressRows = [];
    return;
  }
  const { data, error } = await state.supabase
    .from("segment_progress")
    .select("*")
    .in("assignment_id", ids)
    .order("segment_index", { ascending: true });
  if (error) throw error;
  state.studentProgressRows = data || [];
}

async function selectStudentAssignment(assignmentId) {
  const assignment = state.studentAssignments.find((item) => item.id === assignmentId);
  if (!assignment) return;

  state.assignment = assignment;
  state.lessonPath = assignment.lesson_path;
  localStorage.setItem(selectedAssignmentKey(), assignment.id);
  clearPracticeData();
  setSyncStatus("加载中", "");
  setAudioStatus("正在加载课包...");

  try {
    const rawLesson = await lessonRepository.load(assignment.lesson_path);
    state.lesson = normalizeLesson(rawLesson);
    state.lessonUrl = new URL(assignment.lesson_path, window.location.href).toString();
    if (state.lesson.audioSrc) {
      const audioUrl = new URL(state.lesson.audioSrc, state.lessonUrl).toString();
      els.audio.src = audioUrl;
      els.audio.playbackRate = Number(els.playbackRate.value);
      state.waveform = null;
      setAudioStatus("音频已关联");
    } else {
      els.audio.removeAttribute("src");
      setAudioStatus("此课包没有关联音频");
    }
    applyLocalProgress();
    await loadCloudProgress();
    renderShell();
    saveLocalProgress();
  } catch (error) {
    setAudioStatus(`课包加载失败：${error.message}`);
  }
}

async function loadCloudProgress() {
  if (!state.assignment) return;
  const [progressResult, rowsResult] = await Promise.all([
    state.supabase.from("assignment_progress").select("*").eq("assignment_id", state.assignment.id).maybeSingle(),
    state.supabase
      .from("segment_progress")
      .select("*")
      .eq("assignment_id", state.assignment.id)
      .order("segment_index", { ascending: true }),
  ]);
  if (progressResult.error) throw progressResult.error;
  if (rowsResult.error) throw rowsResult.error;

  const hasCloudData = Boolean(progressResult.data) || Boolean(rowsResult.data?.length);
  if (hasCloudData) {
    clearProgressOnly();
    applyCloudProgress(progressResult.data, rowsResult.data || []);
    setSyncStatus("已恢复", "");
  } else {
    setSyncStatus("本地缓存", "warning");
    scheduleCloudSave(currentSegment());
  }
}

function applyCloudProgress(progress, rows) {
  rows.forEach((row) => {
    state.answers[row.segment_id] = row.answer || "";
    state.submitted[row.segment_id] = Boolean(row.submitted);
    state.playedThrough[row.segment_id] = Boolean(row.heard_through);
    state.listenCounts[row.segment_id] = Number(row.listen_count || 0);
    if (row.score !== null && row.score !== undefined) state.scores[row.segment_id] = Number(row.score);
    if (row.submitted_at) state.submittedAt[row.segment_id] = row.submitted_at;
  });
  state.notes = progress?.notes || "";
  const savedIndex = Number.isInteger(progress?.current_segment_index) ? progress.current_segment_index : firstOpenIndex();
  state.unlockedIndex = computeUnlockedIndex();
  state.currentIndex = Math.max(0, Math.min(savedIndex, Math.max(0, state.lesson.segments.length - 1)));
  if (!canSelectSegment(state.currentIndex)) state.currentIndex = Math.min(state.unlockedIndex, state.lesson.segments.length - 1);
}

function renderShell() {
  const loggedIn = Boolean(state.session && state.profile);
  els.authView.classList.toggle("is-hidden", loggedIn);
  els.appView.classList.toggle("is-hidden", !loggedIn);
  els.signOutButton.classList.toggle("is-hidden", !loggedIn);
  els.userBadge.classList.toggle("is-hidden", !loggedIn);

  if (!loggedIn) {
    els.appStatus.textContent = "登录后进入作业";
    return;
  }

  const roleLabel = isTeacher() ? "老师" : "学生";
  const name = state.profile.full_name || state.profile.email || roleLabel;
  els.userBadge.textContent = `${name} · ${roleLabel}`;
  els.appStatus.textContent = isTeacher() ? "老师工作台" : "学生作业模式";
  document.body.dataset.role = state.profile.role;

  els.teacherPanel.classList.toggle("is-hidden", !isTeacher());
  els.studentTasksPanel.classList.toggle("is-hidden", !isStudent());
  els.practicePanel.classList.toggle("is-hidden", !isStudent());
  els.progressPanel.classList.toggle("is-hidden", !isStudent());

  if (isTeacher()) {
    renderTeacherDashboard();
  } else {
    renderStudentAssignments();
    renderPractice();
  }
}

function renderStudentAssignments() {
  if (!els.assignmentList) return;
  els.assignmentCount.textContent = `${state.studentAssignments.length} 个`;
  if (!state.studentAssignments.length) {
    els.assignmentList.innerHTML = '<div class="empty-state">还没有分配给你的任务</div>';
    return;
  }

  els.assignmentList.innerHTML = "";
  state.studentAssignments.forEach((assignment) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `assignment-row${state.assignment?.id === assignment.id ? " is-active" : ""}`;
    const progress = assignmentProgressPercent(assignment);
    button.innerHTML = `
      <strong>${escapeHtml(assignment.lesson_title)}</strong>
      <span class="assignment-meta">
        <span>${progress}% 完成</span>
        <span>${assignment.due_at ? `截止 ${escapeHtml(formatDateTime(assignment.due_at))}` : "无截止时间"}</span>
      </span>
    `;
    button.addEventListener("click", () => selectStudentAssignment(assignment.id));
    els.assignmentList.appendChild(button);
  });
}

function renderPractice() {
  const segment = currentSegment();
  const total = state.lesson.segments.length;
  els.lessonMeta.textContent = state.assignment ? `${state.lesson.title} · ${total} 句` : "请选择任务";
  els.segmentCounter.textContent = total ? `${state.currentIndex + 1} / ${total}` : "0 / 0";
  els.notesInput.value = state.notes;

  if (!segment) {
    els.timeRange.textContent = "--:-- - --:--";
    els.answerText.textContent = "暂无作业内容";
    els.dictationInput.value = "";
    els.dictationInput.readOnly = true;
    els.checkAnswer.disabled = true;
    els.copySegment.disabled = true;
    els.previousSegment.disabled = true;
    els.nextSegment.disabled = true;
    els.replaySegment.disabled = true;
    els.togglePlay.disabled = true;
    updateSentenceStatus(null);
    updateScoreBadge(null);
    renderProgressSummary();
    drawWaveform();
    return;
  }

  els.timeRange.textContent = `${formatTime(segment.start)} - ${formatTime(segmentEnd(segment))}`;
  els.dictationInput.value = state.answers[segment.id] || "";
  els.dictationInput.readOnly = isSubmitted(segment);
  els.checkAnswer.disabled = isSubmitted(segment);
  els.copySegment.disabled = !isSubmitted(segment);
  els.previousSegment.disabled = state.currentIndex <= 0;
  els.nextSegment.disabled = state.currentIndex >= total - 1;
  const nextIsGated = state.currentIndex < total - 1 && !canAdvanceFromCurrent();
  els.nextSegment.classList.toggle("is-gated", nextIsGated);
  els.nextSegment.title = nextGateMessage() || "下一句";
  const blockedByListenCap = !isSubmitted(segment) && getListenCount(segment) >= MAX_PRE_SUBMIT_LISTENS;
  els.replaySegment.disabled = !els.audio.src || blockedByListenCap;
  els.togglePlay.disabled = !els.audio.src || blockedByListenCap;

  renderAnswerText(segment);
  updateSentenceStatus(segment);
  updateListenCountBadge(segment);
  updateScoreBadge(segment);
  renderProgressSummary();
  drawWaveform();
}

function renderAnswerText(segment) {
  const shouldHide = !isSubmitted(segment);
  els.answerText.classList.toggle("is-hidden", shouldHide);
  if (shouldHide) {
    els.answerText.innerHTML = maskText(segment.text);
  } else {
    els.answerText.textContent = segment.text || "暂无文本";
  }
}

function renderProgressSummary() {
  const total = state.lesson.segments.length;
  const submittedCount = state.lesson.segments.filter((segment) => isSubmitted(segment)).length;
  const heardCount = state.lesson.segments.filter((segment) => isPlayedThrough(segment)).length;
  const listenTotal = state.lesson.segments.reduce((sum, segment) => sum + getListenCount(segment), 0);
  const percent = total ? Math.round((submittedCount / total) * 100) : 0;
  els.progressText.textContent = `${percent}%`;
  els.progressSummary.innerHTML = `
    <div class="summary-item"><strong>${submittedCount}/${total}</strong><span class="muted">已提交</span></div>
    <div class="summary-item"><strong>${heardCount}/${total}</strong><span class="muted">已听完</span></div>
    <div class="summary-item"><strong>${listenTotal}</strong><span class="muted">累计听句次数</span></div>
    <div class="summary-item"><strong>${state.currentIndex + (total ? 1 : 0)}</strong><span class="muted">当前句</span></div>
  `;
}

function renderTeacherDashboard() {
  renderTeacherLessonOptions();
  renderStudents();
  renderTeacherAssignments();
  renderTeacherProgressDetails();
  if (els.teacherStatus) els.teacherStatus.textContent = `${state.students.length} 名学生 · ${state.teacherAssignments.length} 个任务`;
}

function renderTeacherLessonOptions() {
  if (!els.teacherLessonSelect) return;
  els.teacherLessonSelect.innerHTML = "";
  if (!state.library.length) {
    els.teacherLessonSelect.innerHTML = '<option value="">未找到课包</option>';
    return;
  }
  state.library.forEach((lesson) => {
    const option = document.createElement("option");
    option.value = lesson.path;
    option.textContent = lesson.title || lesson.path;
    els.teacherLessonSelect.appendChild(option);
  });
}

function renderStudents() {
  if (!els.studentSelect || !els.studentsList) return;
  els.studentSelect.innerHTML = "";
  if (!state.students.length) {
    els.studentSelect.innerHTML = '<option value="">暂无学生</option>';
    els.studentsList.innerHTML = '<div class="empty-state">学生注册后会出现在这里</div>';
    return;
  }

  els.studentsList.innerHTML = "";
  state.students.forEach((student) => {
    const option = document.createElement("option");
    option.value = student.id;
    option.textContent = student.full_name || student.email || student.id;
    els.studentSelect.appendChild(option);

    const row = document.createElement("div");
    row.className = "compact-person";
    row.innerHTML = `<strong>${escapeHtml(student.full_name || "未命名")}</strong><span class="muted">${escapeHtml(student.email || "")}</span>`;
    els.studentsList.appendChild(row);
  });
}

function renderTeacherAssignments() {
  if (!els.teacherAssignments) return;
  if (!state.teacherAssignments.length) {
    els.teacherAssignments.innerHTML = '<div class="empty-state">还没有分配任务</div>';
    return;
  }

  const studentById = new Map(state.students.map((student) => [student.id, student]));
  const rowsByAssignment = groupProgressByAssignment(state.teacherProgressRows);
  const rows = state.teacherAssignments
    .map((assignment) => {
      const progressRows = rowsByAssignment.get(assignment.id) || [];
      const submittedCount = progressRows.filter((row) => row.submitted).length;
      const listenTotal = progressRows.reduce((sum, row) => sum + Number(row.listen_count || 0), 0);
      const scored = progressRows.filter((row) => row.submitted && row.score !== null && row.score !== undefined);
      const avgScore = scored.length ? Math.round(scored.reduce((sum, row) => sum + Number(row.score || 0), 0) / scored.length) : "--";
      const latest = latestSubmittedAt(progressRows);
      const total = assignment.lesson_segment_count || 0;
      const completion = total ? Math.round((submittedCount / total) * 100) : 0;
      const student = studentById.get(assignment.student_id);
      const active = state.selectedTeacherAssignmentId === assignment.id;
      return `
        <tr>
          <td><button class="ghost-button small-button" data-view-assignment="${assignment.id}" type="button">${active ? "查看中" : "查看"}</button></td>
          <td>${escapeHtml(student?.full_name || student?.email || "未知学生")}</td>
          <td>${escapeHtml(assignment.lesson_title)}</td>
          <td>${completion}% (${submittedCount}/${total})</td>
          <td>${listenTotal}</td>
          <td>${avgScore}</td>
          <td>${latest ? escapeHtml(formatDateTime(latest)) : "--"}</td>
        </tr>
      `;
    })
    .join("");

  els.teacherAssignments.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>明细</th>
          <th>学生</th>
          <th>任务</th>
          <th>完成率</th>
          <th>听了几次</th>
          <th>平均分</th>
          <th>最近提交</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
  els.teacherAssignments.querySelectorAll("[data-view-assignment]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedTeacherAssignmentId = button.dataset.viewAssignment;
      renderTeacherDashboard();
    });
  });
}

function renderTeacherProgressDetails() {
  if (!els.teacherProgress) return;
  const assignment = state.teacherAssignments.find((item) => item.id === state.selectedTeacherAssignmentId);
  if (!assignment) {
    els.teacherProgress.innerHTML = '<div class="empty-state">选择一个任务查看句子明细</div>';
    return;
  }

  const rows = state.teacherProgressRows
    .filter((row) => row.assignment_id === assignment.id)
    .sort((a, b) => Number(a.segment_index || 0) - Number(b.segment_index || 0));
  if (!rows.length) {
    els.teacherProgress.innerHTML = '<div class="empty-state">学生还没有开始这个任务</div>';
    return;
  }

  els.teacherProgress.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>句子</th>
          <th>听了几次</th>
          <th>是否提交</th>
          <th>分数</th>
          <th>提交时间</th>
          <th>答案</th>
        </tr>
      </thead>
      <tbody>
        ${rows
          .map(
            (row) => `
              <tr>
                <td>${Number(row.segment_index || 0) + 1}</td>
                <td>${Number(row.listen_count || 0)}</td>
                <td>${row.submitted ? "已提交" : "未提交"}</td>
                <td>${row.score ?? "--"}</td>
                <td>${row.submitted_at ? escapeHtml(formatDateTime(row.submitted_at)) : "--"}</td>
                <td>${escapeHtml(row.answer || "")}</td>
              </tr>
            `,
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function groupProgressByAssignment(rows) {
  const grouped = new Map();
  rows.forEach((row) => {
    if (!grouped.has(row.assignment_id)) grouped.set(row.assignment_id, []);
    grouped.get(row.assignment_id).push(row);
  });
  return grouped;
}

function latestSubmittedAt(rows) {
  return rows
    .filter((row) => row.submitted_at)
    .map((row) => row.submitted_at)
    .sort()
    .at(-1);
}

function currentSegment() {
  return state.lesson.segments[state.currentIndex] || null;
}

function normalizeLesson(rawLesson) {
  const lesson = rawLesson && typeof rawLesson === "object" ? rawLesson : {};
  const rawSegments = Array.isArray(lesson.segments) ? lesson.segments : [];
  const segments = rawSegments
    .map((segment, index) => ({
      id: String(segment.id || `s${String(index + 1).padStart(3, "0")}`),
      start: toNumberOrNull(segment.start),
      end: toNumberOrNull(segment.end),
      speaker: segment.speaker || "",
      module: segment.module || "",
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

function clearPracticeData() {
  state.assignment = null;
  state.lesson = normalizeLesson({ title: "未选择任务", segments: [] });
  state.lessonPath = "";
  state.lessonUrl = "";
  clearProgressOnly();
  state.waveform = null;
  if (els.audio) els.audio.removeAttribute("src");
}

function clearProgressOnly() {
  state.currentIndex = 0;
  state.answers = {};
  state.submitted = {};
  state.playedThrough = {};
  state.listenCounts = {};
  state.scores = {};
  state.submittedAt = {};
  state.unlockedIndex = 0;
  state.notes = "";
  state.activeListenSegmentId = "";
}

function moveSegment(delta) {
  const nextIndex = Math.max(0, Math.min(state.currentIndex + delta, state.lesson.segments.length - 1));
  selectSegment(nextIndex);
}

function selectSegment(index) {
  if (!canSelectSegment(index)) {
    setAudioStatus(nextGateMessage());
    renderPractice();
    return;
  }
  state.currentIndex = index;
  state.unlockedIndex = Math.max(state.unlockedIndex, index);
  setAudioToSegmentStart();
  els.audio.pause();
  saveLocalProgress();
  scheduleCloudSave(null);
  renderPractice();
}

async function playCurrentSegment(restart) {
  const segment = currentSegment();
  if (!segment || !els.audio.src) return;

  const start = isFiniteNumber(segment.start) ? Number(segment.start) : 0;
  const end = segmentEnd(segment);
  const outsideSegment =
    els.audio.currentTime < start || (isFiniteNumber(end) && els.audio.currentTime >= Number(end) - 0.05);
  const shouldRestart = restart || outsideSegment;
  const shouldCount = shouldCountListen(segment, shouldRestart);
  if (!isSubmitted(segment) && shouldCount && getListenCount(segment) >= MAX_PRE_SUBMIT_LISTENS) {
    setAudioStatus("本句提交前最多听 3 次。请先提交答案。");
    renderPractice();
    return;
  }
  if (shouldRestart) els.audio.currentTime = start;

  if (shouldCount) {
    recordListenAttempt(segment);
  }
  state.activeListenSegmentId = segment.id;
  await safePlay();
}

function shouldCountListen(segment, restarted) {
  if (restarted) return true;
  if (state.activeListenSegmentId !== segment.id) return true;
  const start = isFiniteNumber(segment.start) ? Number(segment.start) : 0;
  return Math.abs(els.audio.currentTime - start) < 0.35;
}

function recordListenAttempt(segment) {
  state.listenCounts[segment.id] = getListenCount(segment) + 1;
  saveLocalProgress();
  scheduleCloudSave(segment);
  updateListenCountBadge(segment);
}

async function togglePlay() {
  if (!els.audio.src) return;
  if (els.audio.paused) {
    await playCurrentSegment(false);
  } else {
    els.audio.pause();
  }
}

async function safePlay() {
  try {
    await els.audio.play();
  } catch (error) {
    setAudioStatus("浏览器阻止了自动播放，请再点一次播放。");
  }
}

function onAudioTimeUpdate() {
  const segment = currentSegment();
  const end = segmentEnd(segment);
  if (!segment || !isFiniteNumber(end)) {
    drawWaveform();
    return;
  }
  if (els.audio.currentTime >= Number(end) - 0.25) {
    markSegmentPlayedThrough(segment);
    els.audio.pause();
    els.audio.currentTime = Number(end);
    state.activeListenSegmentId = "";
    drawWaveform();
    return;
  }
  drawWaveform();
}

function seekFromWaveform(event) {
  const segment = currentSegment();
  if (!segment || !els.audio.src) return;
  if (isStudent() && !isSubmitted(segment)) {
    setAudioStatus("提交前不能拖动音频");
    return;
  }
  const duration = getKnownDuration();
  if (!duration) return;
  const rect = els.waveform.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
  let targetTime = ratio * duration;
  const end = segmentEnd(segment);
  if (isFiniteNumber(segment.start) && isFiniteNumber(end)) {
    targetTime = Math.max(Number(segment.start), Math.min(Number(end), targetTime));
  }
  els.audio.currentTime = targetTime;
  drawWaveform();
}

function submitAnswer() {
  const segment = currentSegment();
  if (!segment || isSubmitted(segment)) return;
  const value = els.dictationInput.value.trim();
  if (!value) {
    els.scoreBadge.className = "score-badge is-low";
    els.scoreBadge.textContent = "请先输入";
    return;
  }

  const now = new Date().toISOString();
  const score = scoreAnswer(segment.text, value);
  state.answers[segment.id] = els.dictationInput.value;
  state.submitted[segment.id] = true;
  state.scores[segment.id] = score;
  state.submittedAt[segment.id] = now;
  state.unlockedIndex = computeUnlockedIndex();

  if (canAdvanceFromCurrent()) {
    setAudioStatus("本句完成，可以进入下一句");
  } else {
    setAudioStatus("答案已提交，请继续播放到本句结束");
  }
  saveLocalProgress();
  scheduleCloudSave(segment, 0);
  renderPractice();
}

function markSegmentPlayedThrough(segment) {
  if (!segment || state.playedThrough[segment.id]) return;
  state.playedThrough[segment.id] = true;
  state.unlockedIndex = computeUnlockedIndex();
  setAudioStatus(isSubmitted(segment) ? "本句完成，可以进入下一句" : "已听到本句结束，请提交答案");
  saveLocalProgress();
  scheduleCloudSave(segment, 0);
  renderPractice();
}

function canListenNow(segment) {
  return isSubmitted(segment) || getListenCount(segment) < MAX_PRE_SUBMIT_LISTENS;
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

function computeUnlockedIndex() {
  if (!state.lesson.segments.length) return 0;
  let unlocked = 0;
  for (let index = 0; index < state.lesson.segments.length; index += 1) {
    const segment = state.lesson.segments[index];
    const hasKnownEnd = isFiniteNumber(segmentEnd(segment));
    const done = isSubmitted(segment) && (isPlayedThrough(segment) || !hasKnownEnd);
    if (!done) break;
    unlocked = Math.min(index + 1, state.lesson.segments.length - 1);
  }
  return unlocked;
}

function firstOpenIndex() {
  const index = state.lesson.segments.findIndex((segment) => !isSubmitted(segment));
  return index >= 0 ? index : Math.max(0, state.lesson.segments.length - 1);
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

function setAudioToSegmentStart() {
  const segment = currentSegment();
  if (!segment || !els.audio.src) return;
  els.audio.currentTime = isFiniteNumber(segment.start) ? Number(segment.start) : 0;
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

function resizeWaveform() {
  const canvas = els.waveform;
  if (!canvas) return;
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
    const startX = (Number(active.start) / duration) * width;
    const endX = (Number(activeEnd) / duration) * width;
    ctx.fillStyle = "rgba(15, 118, 110, 0.14)";
    ctx.fillRect(startX, 0, Math.max(3 * ratio, endX - startX), height);
  }

  ctx.strokeStyle = "#aab8c5";
  ctx.lineWidth = Math.max(1, ratio);
  const midY = height / 2;
  for (let x = 0; x < width; x += 10 * ratio) {
    const bar = ((x / width) * 0.5 + 0.35) * height * 0.42;
    ctx.beginPath();
    ctx.moveTo(x, midY - bar / 2);
    ctx.lineTo(x, midY + bar / 2);
    ctx.stroke();
  }

  const current = duration ? (els.audio.currentTime / duration) * width : 0;
  ctx.strokeStyle = "#be123c";
  ctx.lineWidth = Math.max(2, ratio * 2);
  ctx.beginPath();
  ctx.moveTo(current, 0);
  ctx.lineTo(current, height);
  ctx.stroke();
}

function getKnownDuration() {
  const mediaDuration = getMediaDuration();
  if (mediaDuration) return mediaDuration;
  const ends = state.lesson.segments.map((segment) => segment.end || 0);
  return Math.max(0, ...ends);
}

function getMediaDuration() {
  if (Number.isFinite(els.audio.duration) && els.audio.duration > 0) return els.audio.duration;
  return 0;
}

function saveLocalProgress() {
  if (!state.assignment || !state.session) return;
  localStorage.setItem(
    progressStorageKey(),
    JSON.stringify({
      assignmentId: state.assignment.id,
      lessonPath: state.lessonPath,
      currentIndex: state.currentIndex,
      answers: state.answers,
      submitted: state.submitted,
      playedThrough: state.playedThrough,
      listenCounts: state.listenCounts,
      scores: state.scores,
      submittedAt: state.submittedAt,
      unlockedIndex: state.unlockedIndex,
      notes: state.notes,
      savedAt: new Date().toISOString(),
    }),
  );
}

function applyLocalProgress() {
  if (!state.assignment || !state.session) return;
  try {
    const saved = JSON.parse(localStorage.getItem(progressStorageKey()) || "{}");
    if (saved.assignmentId !== state.assignment.id) return;
    state.currentIndex = Number.isInteger(saved.currentIndex) ? saved.currentIndex : 0;
    state.answers = saved.answers || {};
    state.submitted = saved.submitted || {};
    state.playedThrough = saved.playedThrough || {};
    state.listenCounts = saved.listenCounts || {};
    state.scores = saved.scores || {};
    state.submittedAt = saved.submittedAt || {};
    state.unlockedIndex = Number.isInteger(saved.unlockedIndex) ? saved.unlockedIndex : computeUnlockedIndex();
    state.notes = saved.notes || "";
  } catch (error) {
    clearProgressOnly();
  }
}

function scheduleCloudSave(segment, delay = 650) {
  if (!state.assignment || !state.session || !isStudent()) return;
  if (segment) state.pendingSaveSegmentId = segment.id;
  clearTimeout(cloudSaveTimer);
  cloudSaveTimer = setTimeout(() => saveCloudProgress(segment), delay);
}

async function saveCloudProgress(segment) {
  if (!state.assignment || !state.session || !isStudent()) return;
  if (state.saving) {
    if (segment) state.pendingSaveSegmentId = segment.id;
    return;
  }

  state.saving = true;
  setSyncStatus("同步中", "warning");
  try {
    const completed = state.lesson.segments.length > 0 && state.lesson.segments.every((item) => {
      const hasKnownEnd = isFiniteNumber(segmentEnd(item));
      return isSubmitted(item) && (isPlayedThrough(item) || !hasKnownEnd);
    });
    const progressPayload = {
      assignment_id: state.assignment.id,
      student_id: state.session.user.id,
      current_segment_index: state.currentIndex,
      completed,
      completed_at: completed ? new Date().toISOString() : null,
      notes: state.notes || null,
      updated_at: new Date().toISOString(),
    };
    const { error: progressError } = await state.supabase
      .from("assignment_progress")
      .upsert(progressPayload, { onConflict: "assignment_id" });
    if (progressError) throw progressError;

    const targetSegment = segment || currentSegment();
    if (targetSegment) {
      const { error: rowError } = await state.supabase
        .from("segment_progress")
        .upsert(segmentProgressPayload(targetSegment), { onConflict: "assignment_id,segment_id" });
      if (rowError) throw rowError;
    }

    setSyncStatus("已保存", "");
  } catch (error) {
    setSyncStatus("仅本地缓存", "danger");
    setAudioStatus(`云端保存失败：${error.message}`);
  } finally {
    state.saving = false;
    const pendingId = state.pendingSaveSegmentId;
    state.pendingSaveSegmentId = "";
    if (pendingId && (!segment || pendingId !== segment.id)) {
      const pending = state.lesson.segments.find((item) => item.id === pendingId);
      if (pending) saveCloudProgress(pending);
    }
  }
}

function segmentProgressPayload(segment) {
  return {
    assignment_id: state.assignment.id,
    student_id: state.session.user.id,
    segment_id: segment.id,
    segment_index: state.lesson.segments.findIndex((item) => item.id === segment.id),
    listen_count: getListenCount(segment),
    answer: state.answers[segment.id] || "",
    submitted: isSubmitted(segment),
    score: state.scores[segment.id] ?? null,
    submitted_at: state.submittedAt[segment.id] || null,
    heard_through: isPlayedThrough(segment),
    updated_at: new Date().toISOString(),
  };
}

function assignmentProgressPercent(assignment) {
  const rows = state.studentProgressRows.filter((row) => row.assignment_id === assignment.id);
  const submittedCount = rows.filter((row) => row.submitted).length;
  const total = assignment.lesson_segment_count || 0;
  return total ? Math.round((submittedCount / total) * 100) : 0;
}

function progressStorageKey() {
  return `${STORAGE_PREFIX}${state.session.user.id}:${state.assignment.id}`;
}

function selectedAssignmentKey() {
  return `${STORAGE_PREFIX}${state.session?.user?.id || "anon"}:selected-assignment`;
}

function updateSentenceStatus(segment) {
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

function updateListenCountBadge(segment) {
  if (!segment) {
    els.listenCountBadge.textContent = "听 0/3";
    return;
  }
  const count = getListenCount(segment);
  els.listenCountBadge.textContent = isSubmitted(segment) ? `听 ${count} 次` : `听 ${count}/${MAX_PRE_SUBMIT_LISTENS}`;
  els.listenCountBadge.className = "status-pill";
  if (!isSubmitted(segment) && count >= MAX_PRE_SUBMIT_LISTENS) els.listenCountBadge.classList.add("is-danger");
}

function updateScoreBadge(segment) {
  if (!segment) {
    els.scoreBadge.className = "score-badge";
    els.scoreBadge.textContent = "未作答";
    return;
  }
  if (!isSubmitted(segment)) {
    els.scoreBadge.className = "score-badge";
    els.scoreBadge.textContent = (state.answers[segment.id] || "").trim() ? "未提交" : "未作答";
    return;
  }
  const score = state.scores[segment.id] ?? scoreAnswer(segment.text, state.answers[segment.id] || "");
  els.scoreBadge.textContent = `${score}%`;
  els.scoreBadge.className = "score-badge";
  if (score >= 85) els.scoreBadge.classList.add("is-high");
  else if (score >= 60) els.scoreBadge.classList.add("is-mid");
  else els.scoreBadge.classList.add("is-low");
}

function isSubmitted(segment) {
  return Boolean(segment && state.submitted[segment.id]);
}

function isPlayedThrough(segment) {
  return Boolean(segment && state.playedThrough[segment.id]);
}

function getListenCount(segment) {
  return Number(state.listenCounts[segment?.id] || 0);
}

function isTeacher() {
  return state.profile?.role === "teacher";
}

function isStudent() {
  return state.profile?.role === "student";
}

function disableAuthControls(disabled) {
  els.signInButton.disabled = disabled;
  els.signUpButton.disabled = disabled;
}

function setAuthStatus(text) {
  els.authStatus.textContent = text;
}

function setAudioStatus(text) {
  if (text) els.audioStatus.textContent = text;
}

function setSyncStatus(text, tone) {
  els.syncStatus.textContent = text;
  els.syncStatus.className = "status-pill";
  if (tone) els.syncStatus.classList.add(`is-${tone}`);
}

async function copyCurrentSegment() {
  const segment = currentSegment();
  if (!segment || !isSubmitted(segment)) return;
  try {
    await navigator.clipboard.writeText(segment.text);
    setAudioStatus("已复制本句原文");
  } catch (error) {
    setAudioStatus("浏览器不允许复制，请手动选择提交后的原文。");
  }
}

function maskText(text) {
  return String(text || "")
    .split(/(\s+)/)
    .map((token) => {
      if (/^\s+$/.test(token)) return " ";
      if (!token) return "";
      const width = Math.max(22, Math.min(120, token.length * 11));
      return `<span class="blank-token" style="width:${width}px"></span>`;
    })
    .join("");
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

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isFiniteNumber(value) {
  return Number.isFinite(Number(value));
}

function formatTime(value) {
  if (!isFiniteNumber(value)) return "--:--";
  const minutes = Math.floor(Number(value) / 60);
  const seconds = Math.floor(Number(value) % 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatDateTime(value) {
  if (!value) return "";
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
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
  if (!isStudent()) return;
  if (event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement) return;
  if (event.code === "Space") {
    event.preventDefault();
    togglePlay();
  } else if (event.code === "ArrowLeft") {
    moveSegment(-1);
  } else if (event.code === "ArrowRight") {
    moveSegment(1);
  } else if (event.code === "KeyR") {
    playCurrentSegment(true);
  }
}

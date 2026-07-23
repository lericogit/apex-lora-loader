const DEFAULT_DELAY_MS = 450;


export function activeLoraSignature(state) {
  const active = [];
  for (const section of state?.sections || []) {
    for (const row of section?.loras || []) {
      if (row?.enabled !== true) continue;
      const strength = Number(row.strength);
      active.push([
        typeof row.id === "string" ? row.id : "",
        typeof row.name === "string" ? row.name : "",
        Number.isFinite(strength) ? Math.round(strength * 100) / 100 : 0,
      ]);
    }
  }
  return JSON.stringify(active);
}


export function createAutoQueueController({
  getSignature,
  submit,
  isBlocked = () => false,
  onState = () => {},
  delayMs = DEFAULT_DELAY_MS,
  getDelayMs = () => delayMs,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  if (typeof getSignature !== "function") throw new TypeError("getSignature must be a function.");
  if (typeof submit !== "function") throw new TypeError("submit must be a function.");

  let enabled = false;
  let disposed = false;
  let timer = null;
  let inFlight = false;
  let dirty = false;
  let phase = "off";
  let baseline = getSignature();

  const snapshot = (error = null) => ({
    enabled,
    disposed,
    pending: timer !== null || dirty,
    inFlight,
    phase,
    error,
  });

  const emit = (nextPhase = phase, error = null) => {
    phase = nextPhase;
    onState(snapshot(error));
  };

  const cancelTimer = () => {
    if (timer === null) return;
    clearTimer(timer);
    timer = null;
  };

  const isChanged = () => getSignature() !== baseline;

  const scheduleTimer = () => {
    cancelTimer();
    if (!enabled || disposed || !dirty) return false;
    const configuredDelay = Number(getDelayMs());
    const waitMs = Number.isFinite(configuredDelay)
      ? Math.max(0, Math.round(configuredDelay))
      : DEFAULT_DELAY_MS;
    timer = setTimer(() => {
      timer = null;
      return flush();
    }, waitMs);
    emit("scheduled");
    return true;
  };

  const flush = async () => {
    cancelTimer();
    if (!enabled || disposed) return false;
    if (!isChanged()) {
      dirty = false;
      emit("armed");
      return false;
    }
    dirty = true;
    if (inFlight || isBlocked()) {
      emit("waiting");
      return false;
    }

    const submittedSignature = getSignature();
    dirty = false;
    inFlight = true;
    emit("submitting");
    let success = false;
    let submissionError = null;
    try {
      await submit();
      success = true;
      baseline = submittedSignature;
    } catch (error) {
      // Do not retry a failed submission continuously. A later state change or
      // manually re-arming the control may submit again.
      baseline = submittedSignature;
      submissionError = error;
    } finally {
      inFlight = false;
      if (enabled && !disposed && (dirty || isChanged())) {
        dirty = isChanged();
        if (dirty) {
          scheduleTimer();
          return success;
        }
      }
      if (!disposed) emit(success ? "queued" : "error", submissionError);
    }
    return success;
  };

  const setEnabled = (value) => {
    const next = value === true;
    cancelTimer();
    enabled = next;
    dirty = false;
    baseline = getSignature();
    emit(enabled ? "armed" : "off");
    return enabled;
  };

  const notifyChange = () => {
    if (!enabled || disposed) return false;
    dirty = isChanged();
    if (!dirty) {
      cancelTimer();
      emit("armed");
      return false;
    }
    return scheduleTimer();
  };

  const acknowledgeCurrent = () => {
    cancelTimer();
    dirty = false;
    baseline = getSignature();
    if (!disposed) emit(enabled ? "armed" : "off");
  };

  const resume = () => {
    if (!enabled || disposed || inFlight || timer !== null) return false;
    dirty = dirty || isChanged();
    return dirty ? scheduleTimer() : false;
  };

  const dispose = () => {
    cancelTimer();
    enabled = false;
    dirty = false;
    disposed = true;
    phase = "off";
  };

  return {
    get state() {
      return snapshot();
    },
    setEnabled,
    notifyChange,
    acknowledgeCurrent,
    resume,
    flush,
    dispose,
  };
}

export function createSingleOwnerController({
  mount = () => {},
  render = () => {},
  unmount = () => {},
} = {}) {
  let owner = null;
  let disposed = false;

  const close = (expectedOwner = null) => {
    if (!owner || (expectedOwner && owner !== expectedOwner)) return false;
    const previous = owner;
    owner = null;
    unmount(previous);
    return true;
  };

  return {
    get owner() {
      return owner;
    },

    get disposed() {
      return disposed;
    },

    isOpenFor(node) {
      return !disposed && owner === node;
    },

    open(node) {
      if (disposed || !node) return false;
      if (owner === node) {
        render(node);
        return true;
      }
      if (owner) close();
      owner = node;
      try {
        mount(node);
        render(node);
      } catch (error) {
        owner = null;
        try {
          unmount(node);
        } catch {
          // Preserve the original mount/render failure.
        }
        throw error;
      }
      return true;
    },

    refresh(node) {
      if (disposed || owner !== node) return false;
      render(node);
      return true;
    },

    close,

    nodeRemoved(node) {
      return close(node);
    },

    dispose() {
      if (disposed) return;
      try {
        close();
      } finally {
        disposed = true;
      }
    },
  };
}

export class TaskRouter {
  constructor({ handlers = {} } = {}) { this.handlers = new Map(Object.entries(handlers)); }
  register(type, handler) {
    if (typeof handler !== "function") throw new TypeError("handler must be a function");
    this.handlers.set(type, handler);
  }
  async dispatch(type, payload, context = {}) {
    const handler = this.handlers.get(type);
    if (!handler) throw new Error(`No handler registered for task type: ${type}`);
    return handler(payload, context);
  }
  types() { return [...this.handlers.keys()]; }
}
export default TaskRouter;

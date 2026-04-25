export class Mutex {
  constructor() {
    this.mutex = Promise.resolve();
  }

  lock() {
    let begin = (unlock) => { };
    this.mutex = this.mutex.then(() => {
      return new Promise(begin);
    });
    return new Promise((res) => {
      begin = res;
    });
  }

  async dispatch(fn) {
    const unlock = await this.lock();
    try {
      return await Promise.resolve(fn());
    } finally {
      unlock();
    }
  }
}

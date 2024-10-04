const cache = {
  key: "app_",
  //设置缓存(expire为缓存时效)
  set(key, value, expire) {
    key = this.getKey(key);
    let data = {
      expire: expire ? this.time() + expire : "",
      value,
    };

    if (typeof data === "object") {
      data = JSON.stringify(data);
    }
    try {
      localStorage.setItem(key, data);
    } catch (e) {
      return null;
    }
  },
  get(key) {
    key = this.getKey(key);
    try {
      const data = localStorage.getItem(key);
      if (!data) {
        return null;
      }
      const { value, expire } = JSON.parse(data);
      if (expire && expire < this.time()) {
        localStorage.removeItem(key);
        return null;
      }
      return value;
    } catch (e) {
      return null;
    }
  },
  //获取当前时间
  time() {
    return Math.round(new Date().getTime() / 1000);
  },
  remove(key) {
    key = this.getKey(key);
    localStorage.removeItem(key);
  },
  getKey(key) {
    return this.key + key;
  },
};

export default cache;

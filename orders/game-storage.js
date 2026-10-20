const VERSION=1;

// Game saves use their own namespace; fitted projects are never read or written here.
export function createGameStore(storage,signature){
  if(typeof signature!=='string'||!signature)throw Error('经营存档标识无效。');
  const key=`order-game-v1:${signature}`;
  let loaded=false,readable=false,expected;
  function read(at){
    try{return storage.getItem(at);}catch{throw Error('无法读取经营存档，请检查浏览器本地存储权限。');}
  }
  function write(at,value){
    try{storage.setItem(at,value);}catch{throw Error('经营存档未保存：本地存储空间不足或写入被禁止。');}
  }
  function validate(value){
    if(!value||typeof value!=='object'||Array.isArray(value)||value.version!==VERSION||value.signature!==signature)throw Error('经营存档版本或项目标识不匹配，已保留原存档，请勿覆盖。');
    return value;
  }
  function parse(raw){
    let value;
    try{value=JSON.parse(raw);}catch{throw Error('经营存档已损坏，已保留原内容，无法自动覆盖。');}
    return validate(value);
  }
  function snapshot(state){
    validate(state);let raw;
    try{raw=JSON.stringify(state);}catch{throw Error('经营存档无法转换为保存格式，原存档未修改。');}
    parse(raw);return raw;
  }
  function current(){
    if(!loaded)throw Error('请先读取经营存档，再进行保存。');
    if(read(key)!==expected)throw Error('另一个页面已更新经营存档，请关闭后重新进入。当前页面不会覆盖新进度。');
  }
  function requireReadable(){if(!readable)throw Error('原经营存档无法读取，请通过明确确认的恢复操作保留备份后重新开始。');}
  function preserve(at,raw){
    const previous=read(at);
    if(previous!==null&&previous!==raw){
      let index=1;
      while(read(`${at}:${index}`)!==null)index++;
      write(`${at}:${index}`,previous);
    }
    write(at,raw);
  }
  return {
    key,
    load(){
      const raw=read(key);
      // Even a failed parse establishes the exact snapshot required for explicit recovery.
      expected=raw;loaded=true;readable=false;
      const state=raw===null?null:parse(raw);readable=true;return state;
    },
    save(state){
      const raw=snapshot(state);current();requireReadable();write(key,raw);expected=raw;return state;
    },
    backup(state){
      const raw=snapshot(state);current();requireReadable();
      // Keep earlier backups before replacing the most recent restart snapshot.
      preserve(`${key}:backup`,raw);return state;
    },
    recover(state){
      const raw=snapshot(state);current();
      // Preserve original bytes, including malformed JSON, before replacing the active save.
      if(expected!==null)preserve(`${key}:recovery`,expected);
      current();write(key,raw);expected=raw;readable=true;return state;
    }
  };
}

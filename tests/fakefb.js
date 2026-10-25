(function(){
  let root = window.__INITIAL_DB__ || {};
  const listeners = [];
  const clone = v => v === undefined ? null : JSON.parse(JSON.stringify(v));
  const parts = p => p.split('/').filter(Boolean);
  function get(p){ let c=root; for(const k of parts(p)){ if(c==null||typeof c!=='object') return null; c=c[k]; } return c===undefined?null:c; }
  function clean(o){ if(o&&typeof o==='object'){ for(const k of Object.keys(o)){ o[k]=clean(o[k]); if(o[k]===null||(typeof o[k]==='object'&&!Array.isArray(o[k])&&!Object.keys(o[k]).length)) delete o[k]; } } return o; }
  function setAt(p,v){
    // ".info/serverTimeOffset" la escribe Firebase, no la web: las pruebas la simulan con __DB__.set
    if (!p.startsWith('.info/')) for (const k of parts(p)) if (/[.#$\[\]]/.test(k)) throw new Error('Invalid key '+k);
    (function chk(o){ if(o&&typeof o==='object') for(const k of Object.keys(o)){ if(/[.#$\[\]\/]/.test(k)) throw new Error('Invalid key '+k); chk(o[k]); } })(v);
    const ks=parts(p); if(!ks.length){ root=clone(v)||{}; } else { let c=root; for(const k of ks.slice(0,-1)){ if(c[k]==null||typeof c[k]!=='object') c[k]={}; c=c[k]; } c[ks[ks.length-1]]=clone(v); }
    clean(root); notify();
  }
  function notify(){ listeners.forEach(l=>{ const v=JSON.stringify(get(l.p)); if(v!==l.last){ l.last=v; l.cb(snap(l.p)); } }); }
  const snap = p => ({ val: () => clone(get(p)), key: parts(p).pop() });
  let n=0; const pushId=()=> '-T'+String(Date.now()).padStart(15,'0')+String(n++).padStart(4,'0');
  function ref(p=''){ return {
    on(ev,cb){ const l={p,cb,last:JSON.stringify(get(p))}; listeners.push(l); setTimeout(()=>cb(snap(p)),0); },
    once(ev,cb){ const s=snap(p); return new Promise(r=>setTimeout(()=>{ if(cb) cb(s); r(s); },0)); },
    set(v){ if (window.__failWrites) return Promise.reject(new Error('PERMISSION_DENIED')); try{ setAt(p,v); return Promise.resolve(); }catch(e){ return Promise.reject(e);} },
    update(o){ if (window.__failWrites) return Promise.reject(new Error('PERMISSION_DENIED')); try{ for(const k of Object.keys(o)) setAt(p+'/'+k,o[k]); return Promise.resolve(); }catch(e){ return Promise.reject(e);} },
    remove(){ if (window.__failWrites) return Promise.reject(new Error('PERMISSION_DENIED')); setAt(p,null); return Promise.resolve(); },
    push(v){ if (window.__failWrites) { const r=Promise.reject(new Error('PERMISSION_DENIED')); r.catch(()=>{}); return { then: r.then.bind(r), catch: r.catch.bind(r) }; } const k=pushId(); const pr=ref(p+'/'+k).set(v); const r=ref(p+'/'+k); r.then=pr.then.bind(pr); r.key=k; return r; },
    transaction(fn){ try{ const nv=fn(clone(get(p))); setAt(p,nv); return Promise.resolve({committed:true,snapshot:snap(p)});}catch(e){return Promise.reject(e);} },
    limitToLast(){ return ref(p); }
  };}
  window.__DB__ = { get: p=>clone(get(p)), set: setAt };
  const authListeners = [];
  // Simula la persistencia LOCAL por defecto de Firebase usando localStorage
  let persistencia = 'local';
  const guardado = (() => { try { return JSON.parse(localStorage.getItem('fakeAuthUser')); } catch (e) { return null; } })();
  // admin@test.es usa un UID de administrador real; otro@test.es es una cuenta sin permisos
  const mkUser = email => ({ email, uid: email === 'otro@test.es' ? 'UID_OTRO' : 'mowI2ZkiPTQoz7Kx4P43rfZjxpi1', getIdToken: () => Promise.resolve(email === 'otro@test.es' ? 'tok-otro' : 'tok-admin') });
  const fakeAuth = {
    currentUser: guardado ? mkUser(guardado.email) : null,
    setPersistence(p){ window.__persist = p; persistencia = p; if (p === 'none') localStorage.removeItem('fakeAuthUser'); return Promise.resolve(); },
    onAuthStateChanged(cb){ authListeners.push(cb); setTimeout(()=>cb(fakeAuth.currentUser),0); },
    signInWithEmailAndPassword(email, pass){
      if ((email === 'admin@test.es' || email === 'otro@test.es') && pass === 'buena') {
        fakeAuth.currentUser = mkUser(email);
        if (persistencia === 'local') localStorage.setItem('fakeAuthUser', JSON.stringify({ email }));
        authListeners.forEach(cb => cb(fakeAuth.currentUser));
        return Promise.resolve({ user: fakeAuth.currentUser });
      }
      const e = new Error('bad'); e.code = 'auth/invalid-credential'; return Promise.reject(e);
    },
    signOut(){ fakeAuth.currentUser = null; localStorage.removeItem('fakeAuthUser'); authListeners.forEach(cb => cb(null)); return Promise.resolve(); },
    sendPasswordResetEmail(){ window.__resetSent = true; return Promise.resolve(); }
  };
  ref('').off = function(){};
  window.__DB__ = { get: p=>clone(get(p)), set: setAt };
  window.firebase = { initializeApp(c){ window.__fbConfig = c; }, database(){ return { ref: p => Object.assign(ref(p), { off(){} }) }; }, auth: Object.assign(function(){ return fakeAuth; }, { Auth: { Persistence: { NONE: 'none', SESSION: 'session', LOCAL: 'local' } } }) };
})();

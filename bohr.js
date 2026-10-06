// ボーアモデル（電子殻アニメーション）。仕様は claude.md、見た目の基準は 見本_2D/3D_カルシウム.html。
// 使い方: BOHR.show(入れる要素, 元素記号, 殻ごとの電子数) / BOHR.stop()
const BOHR = (() => {
  const SHELL_NAMES = "KLMNOPQ";
  // 殻ごとの色（K〜N は仕様どおり、O〜Q は見分けやすい色を追加）
  const COLORS = ["#7F77DD", "#378ADD", "#1D9E75", "#BA7517", "#D4537E", "#8FB339", "#3FB6D3"];
  // 回る速さ（ラジアン/秒）。内側ほど速い
  const SPEEDS = [1.6, 1.1, 0.8, 0.55, 0.4, 0.3, 0.22];
  const NUCLEUS = "#D85A30", NUCLEUS_EDGE = "#993C1D", NUCLEUS_TEXT = "#FAECE7";
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  let mode = "2d";
  try { mode = localStorage.getItem("bohrMode") === "3d" ? "3d" : "2d"; } catch (e) {}
  let host = null, current = null, raf = null;
  // 縦長画面での「たたむ」状態。たたんで隠れている間はアニメーションを止めて軽くする
  const portrait = matchMedia("(max-aspect-ratio: 1/1)");
  let active = false, folded = false, asleep = false;
  const sleeping = () => !active || (asleep && portrait.matches);
  const next = fn => { raf = sleeping() ? null : requestAnimationFrame(fn); };   // 次のコマを予約

  // 殻の数に応じてリングの半径を決める（外側が枠からはみ出さないように間隔を詰める）
  function radii(count, first, step, outer) {
    const gap = count > 1 ? Math.min(step, (outer - first) / (count - 1)) : step;
    return Array.from({ length: count }, (_, i) => first + i * gap);
  }

  function shellList(counts, rs) {
    return counts.map((n, i) => ({ n, r: rs[i], sp: SPEEDS[i], c: COLORS[i], t: SHELL_NAMES[i] + n }));
  }

  function pause() {
    if (raf) cancelAnimationFrame(raf);
    raf = null;
    if (three.ready) three.controls.enabled = false;
  }

  // ---------------- 2D版（SVG） ----------------
  function show2D(stage, symbol, counts) {
    const NS = "http://www.w3.org/2000/svg", cx = 340, cy = 190, tilt = -12;
    const shells = shellList(counts, radii(counts.length, 70, 45, 286));
    const dot = counts.length > 5 ? 5 : 6;   // 電子が多い元素は少し小さく
    const el = (name, attrs, parent) => {
      const e = document.createElementNS(NS, name);
      for (const k in attrs) e.setAttribute(k, attrs[k]);
      if (parent) parent.appendChild(e);
      return e;
    };
    // 表示範囲を一番外側のリングに合わせて切り取る（小さい原子は少し余白を残す）
    const R = Math.max(shells[shells.length - 1].r, 160), hw = R + 70, hh = R * 0.62 + 24;
    const svg = el("svg", { viewBox: `${cx - hw} ${cy - hh} ${hw * 2} ${hh * 2}`, class: "bohr-svg", role: "img" });
    el("title", {}, svg).textContent = `${symbol} の電子殻アニメーション`;
    const g = el("g", { transform: `rotate(${tilt} ${cx} ${cy})` }, svg);
    const back = el("g", {}, g), rings = el("g", {}, g);
    el("circle", { cx, cy, r: 30, fill: NUCLEUS, stroke: NUCLEUS_EDGE, "stroke-width": 1 }, g);
    el("text", { x: cx, y: cy, "text-anchor": "middle", "dominant-baseline": "central",
                 style: `font-size:18px;font-weight:500;fill:${NUCLEUS_TEXT}` }, g).textContent = symbol;
    const front = el("g", {}, g), labels = el("g", {}, svg);
    const electrons = [];
    const a = tilt * Math.PI / 180;
    for (const s of shells) {
      s.ry = s.r * 0.32;
      el("ellipse", { cx, cy, rx: s.r, ry: s.ry, fill: "none", stroke: s.c, "stroke-width": 1, opacity: 0.5 }, rings);
      for (let k = 0; k < s.n; k++) {
        electrons.push({ d: el("circle", { r: dot, fill: s.c }, front), s, ph: k * 2 * Math.PI / s.n });
      }
      el("text", { class: "bohr-label", "font-size": counts.length > 5 ? 13 : 16, x: cx + s.r * Math.cos(a) + 6, y: cy + s.r * Math.sin(a) - 4, fill: s.c },
         labels).textContent = s.t;
    }
    stage.replaceChildren(svg);

    function draw(time) {
      for (const o of electrons) {
        const ang = o.ph + (reduce ? 0 : time / 1000 * o.s.sp);
        o.d.setAttribute("cx", cx + o.s.r * Math.cos(ang));
        o.d.setAttribute("cy", cy + o.s.ry * Math.sin(ang));
        const behind = Math.sin(ang) < 0;   // 奥側（原子核の後ろ）を通っているか
        const target = behind ? back : front;
        if (o.d.parentNode !== target) target.appendChild(o.d);
        o.d.setAttribute("opacity", behind ? 0.55 : 1);
      }
      if (!reduce) next(draw);
    }
    draw(0);
    if (!reduce) next(draw);
  }

  // ---------------- 3D版（Three.js r128） ----------------
  const three = { ready: false, loading: null };

  function loadScript(src) {
    return new Promise((ok, ng) => {
      const s = document.createElement("script");
      s.src = src; s.onload = ok; s.onerror = () => ng(new Error(src));
      document.head.appendChild(s);
    });
  }

  // 3D を初めて選んだときだけ Three.js を読み込む（2D だけなら読み込まない）
  function loadThree() {
    if (!three.loading) {
      three.loading = loadScript("https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js")
        .then(() => loadScript("https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js"))
        .then(initThree);
    }
    return three.loading;
  }

  function initThree() {
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));   // Raspberry Pi で重くなりすぎないよう上限
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 1, 3000);
    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const light = new THREE.DirectionalLight(0xffffff, 0.8);
    light.position.set(100, 200, 150);
    scene.add(light);
    Object.assign(three, {
      renderer, scene, camera, controls, atom: null, electrons: [], clock: new THREE.Clock(), ready: true,
      dotGeo: new THREE.SphereGeometry(5, 16, 16),   // 電子の球は全電子で共有して軽くする
    });
    three.resizer = new ResizeObserver(resize3D);   // 表示枠の大きさが変わったら描き直す
  }

  function resize3D() {
    const box = three.renderer.domElement.parentElement;
    if (!box || !box.clientWidth || !box.clientHeight) return;   // たたんで高さ0のときは何もしない
    three.renderer.setSize(box.clientWidth, box.clientHeight);
    three.camera.aspect = box.clientWidth / box.clientHeight;
    three.camera.updateProjectionMatrix();
  }

  // 常に画面のほうを向く文字ラベル
  function makeLabel(text, color, big) {
    const c = document.createElement("canvas"); c.width = 256; c.height = 128;
    const g = c.getContext("2d");
    g.font = "500 72px sans-serif"; g.fillStyle = color;
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(text, 128, 64);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true }));
    s.scale.set(big ? 44 : 36, big ? 22 : 18, 1);
    s.renderOrder = 10;
    return s;
  }

  // 前の元素の図形を片付ける（メモリを解放）
  function disposeAtom() {
    if (!three.atom) return;
    three.atom.traverse(o => {
      if (o.geometry && o.geometry !== three.dotGeo) o.geometry.dispose();
      if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
    });
    three.scene.remove(three.atom);
    three.atom = null;
  }

  function build3D(symbol, counts) {
    disposeAtom();
    const shells = shellList(counts, radii(counts.length, 60, 40, 230));
    const atom = new THREE.Group();
    atom.rotation.x = 0.35; atom.rotation.z = 0.2;   // 土星の環のように傾ける
    atom.add(new THREE.Mesh(new THREE.SphereGeometry(20, 32, 32),
      new THREE.MeshStandardMaterial({ color: NUCLEUS, roughness: 0.5 })));
    atom.add(makeLabel(symbol, NUCLEUS_TEXT, true));
    three.electrons = [];
    for (const s of shells) {
      const pts = [];
      for (let i = 0; i < 128; i++) {
        const a = i / 128 * Math.PI * 2;
        pts.push(new THREE.Vector3(Math.cos(a) * s.r, 0, Math.sin(a) * s.r));
      }
      atom.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: s.c, transparent: true, opacity: 0.6 })));
      const lb = makeLabel(s.t, s.c, false);
      lb.position.set(s.r + 20, 0, 0);
      atom.add(lb);
      const mat = new THREE.MeshStandardMaterial({ color: s.c, roughness: 0.4 });
      for (let k = 0; k < s.n; k++) {
        const m = new THREE.Mesh(three.dotGeo, mat);
        atom.add(m);
        three.electrons.push({ m, s, ph: k * Math.PI * 2 / s.n });
      }
    }
    three.scene.add(atom);
    three.atom = atom;
    // 一番外側の殻の大きさに合わせてカメラの距離を決める（見本: 外側180 → カメラ(0,150,380)）
    // 表示枠が見本より縦長なら、そのぶん離れて全体が収まるようにする
    const k = shells[shells.length - 1].r / 180 * Math.max(1, 1.6 / three.camera.aspect);
    three.camera.position.set(0, 150 * k, 380 * k);
    three.controls.target.set(0, 0, 0);
    three.controls.minDistance = 100 * Math.max(k, 0.6);
    three.controls.maxDistance = 900 * Math.max(k, 0.6);
    three.controls.update();
    three.clock.start();
  }

  function show3D(stage, symbol, counts) {
    stage.innerHTML = `<div class="bohr-msg">3D を読み込み中…</div>`;
    loadThree().then(() => {
      if (mode !== "3d" || current?.symbol !== symbol) return;   // 読み込み中に切り替えられた
      stage.replaceChildren(three.renderer.domElement);
      three.resizer.observe(stage);
      resize3D();
      build3D(symbol, counts);
      const loop = () => {
        const t = reduce ? 0 : three.clock.getElapsedTime();
        for (const o of three.electrons) {
          const a = o.ph + t * o.s.sp;
          o.m.position.set(Math.cos(a) * o.s.r, 0, Math.sin(a) * o.s.r);
        }
        three.controls.update();
        three.renderer.render(three.scene, three.camera);
        next(loop);
      };
      pause();
      three.controls.enabled = true;   // pause() で無効になるので、その後で有効にする
      loop();
    }).catch(() => {
      three.loading = null;   // 次回もう一度試せるようにする
      stage.innerHTML = `<div class="bohr-msg">3D表示を読み込めませんでした。<br>インターネット接続を確認してください。</div>`;
    });
  }

  // ---------------- 外から呼ぶ部分 ----------------
  function render() {
    pause();
    const stage = host.querySelector(".bohr-stage");
    host.querySelectorAll(".bohr-mode button").forEach(b => b.classList.toggle("on", b.dataset.mode === mode));
    host.querySelector(".bohr-help").textContent = mode === "3d"
      ? "ドラッグで回転 / ホイール（スマホは2本指）で拡大縮小 / 右ドラッグで移動" : "";
    if (mode === "3d") show3D(stage, current.symbol, current.counts);
    else show2D(stage, current.symbol, current.counts);
  }

  function show(container, symbol, counts) {
    if (host !== container) {
      host = container;
      host.innerHTML =
        `<div class="bohr-bar"><div class="bohr-mode"><button data-mode="2d">2D</button><button data-mode="3d">3D</button></div>` +
        `<button class="bohr-fold">たたむ</button></div>` +
        `<div class="bohr-stage"></div><div class="bohr-help"></div>` +
        `<div class="bohr-source">データ出典：PubChem</div>`;
      host.querySelectorAll(".bohr-mode button").forEach(b => b.addEventListener("click", () => {
        mode = b.dataset.mode;
        try { localStorage.setItem("bohrMode", mode); } catch (e) {}
        render();
      }));
      host.querySelector(".bohr-fold").addEventListener("click", () => setFolded(!folded));
      // 縦長→横長に回転したら、たたんでいても表示されるのでアニメーションを再開する
      portrait.addEventListener("change", () => { if (!portrait.matches && active && !raf) render(); });
    }
    current = { symbol, counts };
    active = true;
    render();
  }

  function setFolded(on) {
    folded = on;
    host.classList.toggle("folded", on);
    host.querySelector(".bohr-fold").textContent = on ? "ひらく" : "たたむ";
    if (on) {
      setTimeout(() => { if (folded) asleep = true; }, 400);   // 下にしまう動きが終わってから止める
    } else {
      asleep = false;
      if (active && !raf) render();   // 止めていたアニメーションを再開
    }
  }

  // パネルを閉じたとき: アニメーションを止める
  function stop() {
    active = false;
    pause();
  }

  return { show, stop };
})();

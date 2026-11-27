/* Adapted for Axis-Evo on 2026-11-27: clear the widget host without parsing HTML. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.__agDualMascotRig = api;
    root.__agPrismMascotArt = api.mascotArt;
    if (typeof window !== 'undefined' && window && window !== root) {
      window.__agPrismMascotArt = api.mascotArt;
    }
  }
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
  'use strict';

  /**
   * 双宠像素骨架与物理引擎（Aligned to Official Claude Clawd Pixel Grammar）
   * - 主宠栅格 PX = 3 (每格 3 CSS px), 离散动画节拍 TICK = 100ms
   * - 主体与腿爪耳尾零黑描边、零眼高光噪点、纯方块几何、暗部色 's'、1x2 竖瞳 'o'
   * - 动作道具采用同色系柔和中间调渲染
   */
  const PX = 3;
  const TICK = 100;
  const { max, min, round, abs, floor, random, sin, cos, PI } = Math;
  const clamp = (v, lo, hi) => max(lo, min(hi, v));
  const isFin = Number.isFinite;
  const isFn = (v) => typeof v === 'function';
  const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const nowMs = () => performance.now();

  const OFFICIAL_OPEN_REF = [
    '..############..',
    '..############..',
    '..##o######o##..',
    '..##o######o##..',
    '..############..',
    '################',
    '################',
    '..############..',
    '...#.#....#.#...',
    '...#.#....#.#...',
  ];

  const decodePal = (s, base) => {
    const o = base ? { ...base } : {};
    for (const p of s.split(';')) o[p[0]] = p[1] === 'r' ? p.slice(1) : '#' + p.slice(1);
    return o;
  };
  const SHARED_PROP_PALETTE = decodePal(
    'k9c958c;wfbf8f1;cecdfc6;ga8a194;B5b8fb9;bcfe3ee;rcc4f45;ye8b64a;hrgba(20, 20, 19, 0.20);d9a8e80;D6f8ca6;pef9aa6;n8b5e3c;l6a6158;e78716a;F9e3324;fc9642a;Ye0a23c;Vfff1dc;mrgba(120, 112, 104, 0.55);G7dff9b;trgba(125, 255, 155, 0.38);Nff6bd6;urgba(255, 107, 214, 0.38);Weffff3;Z232120;z756f69;A3d8bff;Ed6e8ff;C2753a8;irgba(80, 150, 255, 0.78);Irgba(80, 150, 255, 0.32);Lff3b30;Hffd6d2;xb3312a;jrgba(255, 80, 60, 0.78);Jrgba(255, 80, 60, 0.32);Pd87e64;Mded6cc;Rff3b4f;ac6d9f7;v788eac'
  );
  const PALETTES = {};
  for (const row of (
    'clawd:1:#d97757;sbf684c;o141413;Od97757;qe8a88e;Qf1cbbb|' +
    'cat:1:#947fd6;s735eb5;o141413;ka89fc4;B6a8fd6;O947fd6;qb6a7e6;Qd9cff6|' +
    'dragon:1:#d7dfef;s95a1c2;o1e1936;Oc6cce6;qbfbde6;Qe2e1f7;Uedf1fc;Ta3a5d6;X818ab2|' +
    'whale:1:#4e6fff;s3450cf;o141413;O4e6fff;q86a2ff;Qc7d6ff;Ue5f0ff;Ta8cbff;X38bdf8|' +
    'cowboy:0:#d97757;sbf684c;o141413;H8b5e3c;Ra6744e;hrgba(20, 20, 19, 0.18)|' +
    'shades:0:#e0896b;sc16f53;o141413;G141413;g6d778a;wffffff;hrgba(20, 20, 19, 0.18)|' +
    'wizard:0:#8a74cf;s6a56aa;o141413;M5c4b9e;ye8b64a;bcfe3ee;hrgba(20, 20, 19, 0.18)'
  ).split('|')) {
    const [name, sh, spec] = row.split(':');
    PALETTES[name] = decodePal(spec, sh === '1' ? SHARED_PROP_PALETTE : null);
  }

  // 棱镜边环境反光调色表（6色调：[darkCore,darkWash,lightCore,lightWash]）
  const RIM_PALS = Object.fromEntries(
    'default:164,208,255;155,114,203;37,99,235;124,58,237|warm:255,220,176;240,163,126;194,89,52;217,119,6|cobalt:148,228,255;66,133,244;29,78,216;2,132,199|iris:221,214,254;165,138,248;91,33,182;139,92,246|amber:253,230,138;242,184,75;180,83,9;245,158,11|mono:236,242,248;148,163,184;51,65,85;100,116,139'
      .split('|')
      .map((s) => {
        const [k, v] = s.split(':');
        return [k, v.split(';')];
      })
  );

  const F = (rows, ox = 0, oy = 0, extra = null) =>
    extra ? { rows, ox, oy, ...extra } : { rows, ox, oy };
  const rep = (s, n) => Array(n).fill(s);

  function mirrorFrame(fr, partW) {
    const w = max(...fr.rows.map((r) => r.length));
    const rows = fr.rows.map((r) => r.padEnd(w, '.').split('').reverse().join(''));
    return F(rows, partW - (fr.ox + w), fr.oy, fr.grounded ? { grounded: true } : null);
  }

  function recolorFrame(fr, map) {
    return {
      ...fr,
      rows: fr.rows.map((r) => r.replace(/./g, (ch) => map[ch] || ch)),
    };
  }

  // ── 紧凑 RLE 图集（去重派生 + 自动进入 cdp.js 共享 LZ 压缩池，纯函数解码还原同构对象）──
  const SPRITE_ATLAS_RAW =
    'c.shadow!w12=2,10,g:12h;w14=1,10,g:14h;w10=3,10,g:10h|c.body!stand=2,0:12#*8;tall=2,-1:12#*9;squash=1,2:.12s./14#*6;squash2=1,4:.12s./14#*4;flat=2,7:12s/12#*2;turnL=2,0:11#s*8;turnR=~turnL;leanR=2,0:.12#*4/12#.*4;leanL=~leanR;peek=2,2:12#*6|c.eyes!open=4,2:o6.o*2;openL=@open,3,2;openR=@open,5,2;half=4,3:o6.o;shut=3,3:oo6.oo;happy=3,2:.o6.o./o.o4.o.o;squint=4,2:o6.o/.o4.o./o6.o;wide=3,2:oo6.oo*2;peekOpen=@open,4,4;peekHalf=@half,4,5;flatEyes=4,8:oo4.oo;blink=3,3:ss6.ss;upL=@open,3,1;up=@open,4,1;upR=@open,5,1|c.mouth!small=6,5:.ss.;yawn=6,5:4s/.ss.|c.legs!stand=2,8:.#.#4.#.#.*2;crouch=2,9:.#.#4.#.#.;tuck=2,8:..#.#..#.#..*2;walkA=2,8:.#.s4.#.s./.#6.#3.;walkB=~walkA;dangle=2,8:.#.#4.#.#./.#.#8.*2;dangle2=~dangle;flailA=2,8:#3.#..#3.#/#10.#;flailB=2,8:..#.#..#.#../4.#..#4.;flailC=2,8:#..#4.#..#/3.#4.#..#|c.clawL!stub=0,5:##*2;front=0,5:ss*2;up=0,-2:##*2/#.;peekGrip=1,7:ss;flatLeft=@peekGrip,0,8;open=0,4:##/.#/##|c.clawR!stub=14,5:##*2;front=14,5:ss*2;up=14,-2:##*2/.#;low=14,8:3#*2;reach1=14,4:3.##/5#;write1=@front,13,6;write2=@front;peekGrip=13,7:ss;flatRight=@peekGrip,14,8;open=14,4:##/#./##;waveOut=14,-1:.##*2/#..|k.ears!stand=2,-1:#10.#/##8.##;nod=@stand,2,0;loaf=@stand,2,2;airplane=0,0:##12.##/3#10.3#;peek=@stand,2,1;flat=1,6:#12.#;twitchL=2,-1:11.#/##8.##;twitchR=~twitchL|k.body!stand=2,1:12#*7;loaf=1,4:.12s./14#*5;stretch=2,0:s11#/12#*2/.11#*2/..10#/12#*2;turnL=2,1:11#s*7;turnR=~turnL;leanR=2,1:.12#*4/12#.*3;leanL=~leanR|k.eyes!loafShut=3,6:oo6.oo;loafHalf=4,6:o6.o|k.paws!none=0,0:;groom1=12,4:ss*2;groom2=@groom1,12,3;cheer=0,2:#14.#*2;up=0,-1:##12.##*2;peekGrip=1,7:ss10.ss;write1=@groom1,13,5;write2=@groom1,14,6;upR=14,0:##*2|' +
    'k.tail!up=14,3:.s/.#*2/##;sway=14,3:.#*2/s#/#.;curl=14,4:##/.#/s#;loaf=14,6:.#*2/s#;puff=14,2:.#/##*2/s#/#.|' +
    'd.ears!stand=1,-1:.T12.T./..XT8.TX..;nod=@stand,1,0;loaf=@stand,1,0;airplane=1,-1:T14.T/.XT10.TX.;peek=@stand,1,1;flat=1,6:.T12.T.;twitchL=1,-1:.E12.T./..XT8.TX..;twitchR=~twitchL,1,-1|' +
    'd.body!stand=2,1:12#*4/3#6U3#/3#6q3#/3#6U3#;squash=1,2:.12s./14#*2/4#6U4#/4#6q4#/4#6U4#;loaf=@squash;stretch=2,0:s11#/12#*2/.11#*2/..3#6U#/3#6q3#/3#6U3#;flat=2,7:12s/12#/3#6U3#;turnL=2,1:11#s*4/##6U3#s/##6q3#s/##6U3#s;turnR=~turnL;leanR=2,1:.12#*4/3#6U3#./3#6q3#./3#6U3#.;leanL=~leanR;peek=2,2:12#*4/3#6U3#/3#6q3#|' +
    'd.legs!stand=2,8:.##6.##.*2;crouch=2,9:.##6.##.;tuck=2,8:..##4.##..*2;walkA=2,8:.##6.ss./.##9.;walkB=~walkA;dangle=2,8:.##6.##./.##9.*2;dangle2=~dangle;flailA=2,8:##8.##*2;flailB=2,8:..##4.##../3.##..##3.;flailC=2,8:##..##4.##/3.##4.##.|' +
    'd.paws!none=0,2:X14.X/Xq12.qX/.X12.X.;cheer=0,0:X14.X/Xq12.qX/.XX10.XX.;up=-1,1:XX14.XX/Xqq12.qqX/.XX12.XX.;upR=0,0:14.XX/13.qX/13.X.;groom1=0,2:X14.X/Xq11.ss/.X11.ss;groom2=@groom1,0,1;write1=0,3:X14./Xq11.ss/.X11.ss;write2=0,3:X14./Xq12.ss/.X12.ss;peekGrip=1,7:ss10.ss;tuck=1,4:X12.X*2|' +
    'd.tail!up=14,4:3.T/..XT/.##./##s.;sway=14,5:3.T/.##T/##s.;curl=14,6:.##T/##s.;loaf=@curl;puff=14,3:3.T/..#T/.##./##s.|' +
    'w.body!stand=2,1:.10#./12#*4/##8U##/#10U#/.#8U#./..8T..;squash=1,3:..10s../.12#./14#*2/##10U##/.#10U#./..10T..;loaf=2,4:.10s./12#*2/##8U##/#10U#/.10T.;stretch=2,0:.s9#./12#*4/##8U##/#10U#/.#8U#./..8T..;flat=2,7:.10s./12#/#10U#;turnL=2,1:.9#s./11#s*4/#8U##s/10U#s/.8U#s./..8T..;turnR=~turnL;leanR=2,1:..10#/.12#*4/.##8U##/#10U#./.#8U#../..8T..;leanL=1,1:.10#../12#.*4/##8U##./.#10U#/..#8U#./..8T..;peek=2,2:.10#./12#*4/##8T##|' +
    'w.paws!none=0,6:.s/ss;flap=0,5:ss/.s;cheer=0,4:ss12.ss/.s12.s.;up=@cheer,0,2;upR=14,4:ss/.s;groom1=0,5:.s11.ss/ss11.ss;groom2=@groom1,0,4;write1=@groom1,0,5;write2=0,6:.s12.ss/ss12.ss;peekGrip=1,7:ss10.ss;tuck=1,7:s|' +
    'w.tail!up=13,1:..#..#/..4#/3.##./..3#./.3#../##s3.;sway=13,2:3.#..#/..4#./..3#../.3#3./##s4.;curl=13,3:..#.#./..3#./.3#../##s3.;loaf=13,5:..#.#./.3#../##s3.;puff=13,0:..#..#/..4#/..3#./.3#../3#3./##s3.|' +
    'p!dragonFlame0=14,4:.f./YVf/.f.;dragonFlame1=14,3:..fF./.YVfF/VYYfF/.fF..;dragonFlame2=14,3:3.fF./.fYVfF/VYYfF./..fF..;whaleSpout0=5,-3:.B..B./..AA../..BA../..AA..;whaleSpout1=4,-5:.B4.B./B.A..A.B/..AB.BA./3.AA3./3.BA3./3.AA3.;whaleSpout2=3,-5:..B4.B../.A6.A./B3.BB3.B/4.AA4./.B..BA..B./4.AA4.;quill1=15,3:..B/.B./k..;quill2=@quill1,16,4;sheet=12,8:6c/ckk3c/6g;mug=13,4:..4D/3DbwD/D.DbbD/3DbbD/..4D;cloth1=13,2:cw../w3c/.cwc/..c.;cloth2=14,3:..cw/3cw/.cwc/..c.;bowl=12,7:5w/DBwBD/.3D.;bowlEmpty=12,8:D3gD/.3D.;chop1=12,4:3.n/..n./.n../n3.;chop2=12,3:3.n/..n./.n../w3.;fishDish=11,7:.PPsPP./7D/.5D.;fishBone=11,7:.M.M.M./7D/.5D.;envS=12,5:6d/ddwwdd/dwddwd/d4wd/6d;envSOpen=12,4:..dd../.dwwd./6d/d4wd*2/6d;letter=14,1:7d/d5cd/d3gccd/d5cd/d4gcd/d5cd/dggccrd/7d;seed=15,8,g:On/nO;p1=16,7,g:O/l*2;p2=16,6,g:O/l*3;p3=14,5,g:..O../..l../O.l.O/.3l./..l..;p4=14,3,g:..O../O.l.O/.3l./O.l.O/.3l./..l..*2;d1=13,0,g:3.O3./O5.O/.O3.O./7./O5.O/7.*2/3.O3.;d2=13,-2,g:.q3.q./3.q3./q5.q/7./.q3.q./7./3.q3.;wilt1=14,3,g:..q../q.l.q/.3l./q.l.q/.3l./..l..*2;wilt2=14,4,g:q4./.q.q./..ll./.q.l./..ll./..l..;wilt3=15,6,g:Q.Q/.l./Ql./.l.;bfUp=13,-4:B3.B/BB.BB/.BkB./..k..;bfDn=13,-4:5.*2/BBkBB/.BkB.;bfLeftUp=@bfUp,1,-5;bfLeftDn=@bfDn,1,-5;bfRest=7,-3:..B../.BB../..k..;stickUp=14,-9:WW/GG*6;stickLT=9,-9:5.tt/WG3.tt/.GG..tt/..GG.tt/3.GGtt/4.GGt/5.GG;stickRT=~stickLT,14,-9;sirenDim=5,-4:..LL../.4x.*2/6l;sirenL=5,-4:..Lx../.HLxx./.LLxx./6l;sirenF=5,-4:..HH../.LHHL./.4L./6l;sirenR=~sirenL;beamL=-1,-7:J5./.j4./..j3./6./J3j../6./.Jjj..;beamF=4,-7:J..JJ..J/.j.jj.j.;micStand=1,4,g:6.ZZ6./6.Zz6./6.ZZ6./6.Z7.*2/5.4Z5.;micSink1=1,6,g:6.ZZ6./6.Zz6./6.ZZ6./5.4Z5.;micSink2=1,8,g:6.ZZ6./5.4Z5.;smoke=6,-4:.m./mm./.mm/.m.;iceCrystal=5,-6:..av../.aavv./3a3v/.aavv./..av..;iceCrystalHi=@iceCrystal,5,-7;laser0=16,7,g:.p./pRp/.p.;laser1=18,8,g:.R./RpR;laser2=15,8,g:pRp/.R.;blueprint=12,2:7B/B4EBB/BE3BEB/B4EBB/BE3BEB/7B;headband=1,1:.12L.L/..10H..L;goalFlame0=4,-7,g:3.Y3./..fYf../.FfYfF./FfYVYfF;goalFlame1=4,-7,g:..Y4./.fYf..Y/FfYVYf./.FfYfF.;goggles=3,0:gAAg..gAAg/gEAg..gEAg;iceCrystalSpin=6,-7:.av./aavv*2/.av.;flag0=14,-6:l4A./lAAyA./l4A./l5.*4;flag1=14,-6:l..3A/lAAyAA/l3A../l5.*4;shadesProp=3,2:4Z..4Z/ZEZZ..ZEZZ;surfboard=1,8,g:..10A../.A10EA.;waveSplash0=-3,6,g:..E./E.A./.AA.;waveSplash1=-3,6,g:E3./.EA./AA..;cloudBig=12,2:..3w../.w3Ew./5wbw/.5b.;cloudMid=13,3:.3w./wEEbw/.3b.;cubeGlow=13,3:.y.y./A3EA/AEyEA/5A;hourglass0=13,1:5n/.byb./..y../.b.b./5n;hourglass1=13,1:5n/.b.b./..y../.byb./5n;pocketWatch=12,4:..y../.ywy./ywnwy/.3y.;micHand=13,2:.ZZ./ZwZZ/.gg./..g.*2;spotlight=5,-9:..VV../.VyyV./V.yy.V;book0=12,4:5B/B3wB/BwgwB/B3wB/5B;book1=12,4:BB.BB/BwBwB/BwgwB/BwBwB/BB.BB;bulbOff=5,-8:..gg../.g..g.*2/..cc..;bulbOn=5,-9:y.yy.y/.yVVy./y4Vy/..yy../..cc..;hotCup0=12,3:.m..m./m..m../5D./D3nDD/D3nD./.3D..;hotCup1=12,3:m..m../.m..m./5D./D3nDD/D3nD./.3D..;donut0=12,4:.3p./pywpp/pp.pn/5n/.3n.;donut1=12,4:.pp../pyw../pp.pn/5n/.3n.;habCactus=0,0,g:3.P3./..lGl../l.lGl../lGlGl.l/..lGlGl/.5n./..3n..;habLamp=0,0,g:..3l../.l3Vl./.l3Yl./..3l../3.z3.*4/..3z..;habHourglass=0,0,g:.5n./..byb../3.y3./..byb../.5n.|s!heart=5,-7:.r.r./5r/.3r./..r..;spark=5,-8:..y..*2/5y/..y..*2;z1=10,-6:4k/..k./.k../4k;z2=12,-9:3k/.k./3k;vein=5,-7:.r.r./rr.rr/5./rr.rr/.r.r.;bang=6,-8:.r.*3/3./.r.;q=5,-9:.3k./k3.k/3.k./..k../5./..k..;note=5,-8:..kk./..k.k/..k../3k../kk3.;sweat=13,-4:.B./BbB*2/.B.;tilde=5,-7:.k3./k.k.k/3.k.;dozeZ0=@z2,12,-3;dozeZ1=@z1,13,-7;dozeZ2=14,-12:5k/3.k./..k../.k3./5k;fireSpark0=5,-8:..Y../f3.V/..f..;fireSpark1=5,-9:.V..f/..Y../f4.;fireSpark2=5,-8:f..Y./4.V/.f3.;sleepBubble0=12,4:.b./bEb/.b.;sleepBubble1=12,3:.bb./bEwb/bEEb/.bb.|m!cowboy=0,-2:5.6H5./3.10H3./..12R../..12#../..##o6#o##../16#/..12#../3.#.#4.#.#3.;shades=0,0:..12#../..4Gg##g4G../..12G../16#/..12#../3.#.#4.#.#3.;wizard=0,-3:7.MM7./6.MyMM6./5.6M5./..12M../..12#../..##o6#o##../16#/..12#../3.#.#4.#.#3.|ma.cowboy!trick=0,-2:4.6H6./..10H4./.12R3./..12#../..##o6#o##../16#/..12#../..#..#4.#..#..|ma.shades!trick=0,0:..12#../..GwGGw##GwGGw../..12G../16#/..12#../3.#.#4.#.#3.|ma.wizard!trick=0,-3:5.y10./4.yMyMM7./5.6M5./..12M../..12#../..##o6#o##../16#/..12#y./3.#.#4.#.#.y.';

  function decodeSpriteAtlas(raw) {
    const out = { c: {}, k: {}, d: {}, w: {}, p: {}, s: {}, m: {}, ma: {} };
    for (const sec of raw.split('|')) {
      const bi = sec.indexOf('!');
      const pk = sec.slice(0, bi).split('.');
      const grp = {};
      for (const item of sec.slice(bi + 1).split(';')) {
        const eq = item.indexOf('=');
        const name = item.slice(0, eq);
        const rhs = item.slice(eq + 1);
        const c0 = rhs[0];
        if (c0 === '@' || c0 === '~') {
          const [ref, ox, oy] = rhs.slice(1).split(',');
          const src = c0 === '~' ? mirrorFrame(grp[ref], 16) : grp[ref];
          grp[name] = ox !== undefined ? { ...src, ox: +ox, oy: +oy } : c0 === '~' ? src : { ...src };
          continue;
        }
        const co = rhs.indexOf(':');
        const [ox, oy, fl] = rhs.slice(0, co).split(',');
        const body = rhs.slice(co + 1);
        const rows = [];
        if (body) {
          for (const seg of body.split('/')) {
            const st = seg.indexOf('*');
            const rRaw = st >= 0 ? seg.slice(0, st) : seg;
            const n = st >= 0 ? +seg.slice(st + 1) : 1;
            const row = rRaw.replace(/(\d+)(.)/g, (_, cnt, ch) => ch.repeat(+cnt));
            for (let i = 0; i < n; i++) rows.push(row);
          }
        }
        grp[name] = fl === 'g' ? { ox: +ox, oy: +oy, grounded: true, rows } : { ox: +ox, oy: +oy, rows };
      }
      if (pk.length === 1) out[pk[0]] = grp;
      else out[pk[0]][pk[1]] = grp;
    }
    return out;
  }

  const _A = decodeSpriteAtlas(SPRITE_ATLAS_RAW);
  const CLAWD_PARTS = _A.c;
  const CAT_PARTS = { shadow: CLAWD_PARTS.shadow, ..._A.k, mouth: CLAWD_PARTS.mouth, legs: CLAWD_PARTS.legs };
  CAT_PARTS.body.squash = CLAWD_PARTS.body.squash;
  CAT_PARTS.body.flat = CLAWD_PARTS.body.flat;
  CAT_PARTS.body.peek = CLAWD_PARTS.body.peek;
  for (const [ek, ef] of Object.entries(CLAWD_PARTS.eyes)) {
    if (ek === 'peekHalf') continue;
    CAT_PARTS.eyes[ek] = ek === 'peekOpen' || ek === 'flatEyes' ? ef : { ...ef, oy: ef.oy + 1 };
  }
  const DRAGON_PARTS = {
    shadow: CLAWD_PARTS.shadow,
    ..._A.d,
    eyes: CAT_PARTS.eyes,
    mouth: CLAWD_PARTS.mouth,
  };
  const WHALE_PARTS = {
    shadow: CLAWD_PARTS.shadow,
    ..._A.w,
    ears: {},
    legs: {},
    eyes: {
      ...CAT_PARTS.eyes,
      loafShut: { ...CAT_PARTS.eyes.loafShut, oy: 5 },
      loafHalf: { ...CAT_PARTS.eyes.loafHalf, oy: 5 },
    },
    mouth: CLAWD_PARTS.mouth,
  };
  const PROPS = _A.p;
  const SYMS = _A.s;
  const MINI_SPRITES = _A.m;
  const MINI_ANIM_FRAMES = _A.ma;
  for (const id of ['cowboy', 'shades', 'wizard']) {
    const b = MINI_SPRITES[id];
    MINI_ANIM_FRAMES[id].walkB = { ox: b.ox, oy: b.oy, rows: [...b.rows.slice(0, -1), '..s#.#....#.#s..'] };
  }

  ['stickUp', 'stickLT', 'stickRT'].forEach((k) => {
    PROPS[k + 'M'] = recolorFrame(mirrorFrame(PROPS[k], 16), { G: 'N', t: 'u' });
  });
  PROPS.beamR = mirrorFrame(PROPS.beamL, 16);
  ['sirenDim', 'sirenL', 'sirenF', 'sirenR', 'beamL', 'beamR', 'beamF'].forEach((k) => {
    PROPS[k + 'B'] = recolorFrame(PROPS[k], { L: 'A', H: 'E', x: 'C', j: 'i', J: 'I' });
  });

  // 背后火海算法生成（保留轮廓白光 'V'）
  (() => {
    const sil = new Set();
    for (let y = 0; y <= 7; y++) for (let x = 2; x <= 13; x++) sil.add(`${x},${y}`);
    for (let y = 5; y <= 6; y++) [0, 1, 14, 15].forEach((x) => sil.add(`${x},${y}`));
    for (let y = 8; y <= 9; y++) [3, 5, 10, 12].forEach((x) => sil.add(`${x},${y}`));
    const glow = (x, y) =>
      y <= 9 && !sil.has(`${x},${y}`) && [-1, 0, 1].some((dx) => [-1, 0, 1].some((dy) => sil.has(`${x + dx},${y + dy}`)));
    const X0 = -3;
    const W = 22;
    const TONGUES = [
      [[-1, 15, 3, 3, 1], [3, 2, 3, 3, 0], [7, 10, 2, 3, -1.5], [11, 4, 3, 3, 0], [16, 14, 3, 3, -0.5]],
      [[-1, 14, 3, 3, 1.5], [3, 3, 3, 3, 0], [7, 11, 3, 2, -2], [11, 3, 3, 3, 0], [16, 15, 3, 3, -1]],
    ];
    const base = (x) => (x >= 2 && x <= 13 ? 0 : x >= 0 && x <= 15 ? 5 : 8);
    const mk = (k, f) => {
      const tips = TONGUES[f % 2].map(([cx, h, sl, sr, lean], i) => {
        const by = base(cx);
        return { cx, by, ty: by - round(h * k), sl, sr, h, sw: lean + 2.4 * sin((f * PI) / 2 + i * 1.3) };
      });
      const heat = (x, y) =>
        max(-1, ...tips.map(({ cx, by, ty, sl, sr, sw }) => {
          const rel = max(0, min(1, (by - y) / max(1, by - ty)));
          const c = cx + sw * rel * rel;
          return y - ty - (x < c ? sl : sr) * abs(x - c);
        }));
      const embers = new Set();
      tips.forEach(({ cx, ty, h, sw }, i) => {
        if (i % 3 === f % 3 && h * k >= 4) embers.add(`${round(cx + sw + (i % 2 ? 1 : -1))},${ty - 2}`);
      });
      let y0 = 0;
      for (let y = -16; y <= 9; y++) for (let i = 0; i < W; i++) if (heat(X0 + i, y) >= 0 || embers.has(`${X0 + i},${y}`)) y0 = min(y0, y);
      const cells = [];
      for (let y = y0 - 1; y <= 9; y++) {
        cells.push(Array.from({ length: W }, (_, i) => {
          const x = X0 + i;
          if (sil.has(`${x},${y}`)) return '.';
          if (glow(x, y)) return 'V';
          if (embers.has(`${x},${y}`)) return 'f';
          const e = heat(x, y);
          return e < 0 ? '.' : e < 1 ? 'F' : e < 4 ? 'f' : 'Y';
        }).join(''));
      }
      return F(cells, X0, y0 - 1, { grounded: true });
    };
    [[1, 0.35], [2, 0.7], [3, 1.05]].forEach(([lv, k]) => {
      for (let f = 0; f < 4; f++) PROPS['fire' + lv + f] = mk(k, f);
    });
  })();

  // ── 刚体层与符号层登记（符号层水平镜像时仅翻转锚点，字符正向绘制）────────
  const RIGID_LAYERS = new WeakSet();
  const SYM_LAYERS = new WeakSet();
  Object.values(PROPS).forEach((l) => RIGID_LAYERS.add(l));
  Object.values(SYMS).forEach((l) => {
    RIGID_LAYERS.add(l);
    SYM_LAYERS.add(l);
  });

  // 整格平移帧（带缓存，传递刚体与符号标记）
  const SHIFT_CACHE = new WeakMap();
  function shiftFrame(fr, dx, dy) {
    if (!fr || (!dx && !dy)) return fr;
    let bucket = SHIFT_CACHE.get(fr);
    if (!bucket) {
      bucket = new Map();
      SHIFT_CACHE.set(fr, bucket);
    }
    const key = dx + ',' + dy;
    let out = bucket.get(key);
    if (!out) {
      out = { ...fr, ox: fr.ox + dx, oy: fr.oy + dy };
      bucket.set(key, out);
      if (RIGID_LAYERS.has(fr)) RIGID_LAYERS.add(out);
      if (SYM_LAYERS.has(fr)) SYM_LAYERS.add(out);
    }
    return out;
  }

  function resolveClawdStandGrid() {
    const grid = Array.from({ length: 10 }, () => Array(16).fill('.'));
    const paint = (part) => {
      part.rows.forEach((row, ry) => {
        for (let rx = 0; rx < row.length; rx++) {
          const ch = row[rx];
          if (ch !== '.' && ch !== ' ') {
            const x = part.ox + rx;
            const y = part.oy + ry;
            if (y >= 0 && y < 10 && x >= 0 && x < 16) grid[y][x] = ch;
          }
        }
      });
    };
    paint(CLAWD_PARTS.legs.stand);
    paint(CLAWD_PARTS.body.stand);
    paint(CLAWD_PARTS.eyes.open);
    paint(CLAWD_PARTS.clawL.stub);
    paint(CLAWD_PARTS.clawR.stub);
    return grid.map((r) => r.join(''));
  }

  function drawLayerSet(ctx, oxGrid, oyGrid, pxSize, palette, layers, colorResolver = null) {
    let lf = '';
    for (const part of layers) {
      if (!part || !part.rows || !part.rows.length) continue;
      for (let ry = 0; ry < part.rows.length; ry++) {
        const row = part.rows[ry], py = (oyGrid + part.oy + ry) * pxSize, gy = part.oy + ry;
        for (let rx = 0; rx < row.length; rx++) {
          const ch = row[rx];
          if (ch === '.' || ch === ' ') continue;
          const gx = part.ox + rx;
          const color = colorResolver ? colorResolver(ch, gx, gy, palette) : palette[ch];
          if (!color) continue;
          let r = 1;
          while (rx + r < row.length) {
            const nc = row[rx + r];
            if (nc === '.' || nc === ' ') break;
            if ((colorResolver ? colorResolver(nc, gx + r, gy, palette) : palette[nc]) !== color) break;
            r++;
          }
          if (color !== lf) ctx.fillStyle = lf = color;
          ctx.fillRect((oxGrid + gx) * pxSize, py, pxSize * r, pxSize);
          rx += r - 1;
        }
      }
    }
  }

  // ── 整数格挤压（替代 ctx.scale 浮点缩放）─────────────────────────────────
  // 思路：把弹性身体部件合成为一张字符点阵，再按「中心接缝最近邻」在整格层面
  // 增删行/列（优先选纯色体块行列、靠近中心、保护眼睛 o 与暗面 s 特征和着地腿），
  // 水平中心与底边锚定。这样每个方块永远是精确 PX×PX，边缘锐利不糊。
  function compositeGrid(layers) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const part of layers) {
      if (!part || !part.rows) continue;
      part.rows.forEach((row, ry) => {
        for (let rx = 0; rx < row.length; rx++) {
          const ch = row[rx];
          if (ch === '.' || ch === ' ') continue;
          const x = part.ox + rx;
          const y = part.oy + ry;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      });
    }
    if (minX === Infinity) return null;
    const W = maxX - minX + 1;
    const H = maxY - minY + 1;
    const g = Array.from({ length: H }, () => Array(W).fill('.'));
    for (const part of layers) {
      if (!part || !part.rows) continue;
      part.rows.forEach((row, ry) => {
        for (let rx = 0; rx < row.length; rx++) {
          const ch = row[rx];
          if (ch === '.' || ch === ' ') continue;
          g[part.oy + ry - minY][part.ox + rx - minX] = ch;
        }
      });
    }
    return { g, minX, minY, W, H };
  }

  // 选择要删除/复制的接缝线（行或列）；lines 为字符串数组
  function pickSeams(lines, count, remove, protectTail) {
    const n = lines.length;
    if (!count || n < 3) return new Set();
    const center = (n - 1) / 2;
    const cand = [];
    for (let i = 0; i < n; i++) {
      const line = lines[i];
      const blank = !/[^.]/.test(line);
      const pure = !blank && /^[#.]+$/.test(line);
      const same = (i > 0 && lines[i - 1] === line) || (i < n - 1 && lines[i + 1] === line);
      let score = abs(i - center) + (pure ? 0 : same ? 2 : 20);
      if (blank) score += 40;
      if (protectTail && i >= n - protectTail) score += 30;
      if (i === 0 || i === n - 1) score += 8;
      cand.push({ i, score, pure });
    }
    cand.sort((a, b) => a.score - b.score || a.i - b.i);
    const chosen = new Set();
    const limit = min(count, n - 2);
    // 第一轮：删除非纯色线时必须保留一条未被删除的同形邻线，防止特征整体消失
    for (const c of cand) {
      if (chosen.size >= limit) break;
      if (remove && !c.pure) {
        const ok = (j) => j >= 0 && j < n && !chosen.has(j) && lines[j] === lines[c.i];
        if (!ok(c.i - 1) && !ok(c.i + 1)) continue;
      }
      chosen.add(c.i);
    }
    for (const c of cand) {
      if (chosen.size >= limit) break;
      chosen.add(c.i);
    }
    return chosen;
  }

  function buildSeamMap(n, removeSet, dupSet) {
    const map = [];
    for (let i = 0; i < n; i++) {
      if (removeSet.has(i)) continue;
      map.push(i);
      if (dupSet.has(i)) map.push(i);
    }
    return map;
  }

  /**
   * 对弹性部件做整数格挤压，返回 { layer, shiftX(x), shiftY(y) }。
   * sqW / sqH 为整数格增量（正=拉宽/拉高，负=压窄/压扁）。
   */
  function squashLayersToGrid(layers, sqW, sqH) {
    const comp = compositeGrid(layers);
    if (!comp) return null;
    const { g, minX, minY, W, H } = comp;
    const rowsStr = g.map((r) => r.join(''));
    const colsStr = Array.from({ length: W }, (_, x) => g.map((r) => r[x]).join(''));
    const dw = max(-(W - 2), round(sqW || 0));
    const dh = max(-(H - 2), round(sqH || 0));
    const colPick = pickSeams(colsStr, abs(dw), dw < 0, 0);
    const rowPick = pickSeams(rowsStr, abs(dh), dh < 0, 2);
    const colMap = buildSeamMap(W, dw < 0 ? colPick : new Set(), dw > 0 ? colPick : new Set());
    const rowMap = buildSeamMap(H, dh < 0 ? rowPick : new Set(), dh > 0 ? rowPick : new Set());
    const newW = colMap.length;
    const newH = rowMap.length;
    const left = minX + round((W - newW) / 2); // 水平中心锚定
    const top = minY + (H - newH); // 底边锚定
    const rows = rowMap.map((ry) => colMap.map((cx) => g[ry][cx]).join(''));
    // 源行/列 → 目标位置（被删除的线映射到其下方/右方最近保留线）
    const targetOf = (map, src, n) => {
      for (let s = src; s < n; s++) {
        const t = map.indexOf(s);
        if (t >= 0) return t;
      }
      return map.length;
    };
    const shiftY = (y) => {
      if (y > minY + H - 1) return 0;
      const src = max(0, y - minY);
      return top + targetOf(rowMap, src, H) - (minY + src);
    };
    const shiftX = (x) => {
      const src = clamp(x - minX, 0, W - 1);
      return left + targetOf(colMap, src, W) - (minX + src);
    };
    return { layer: { rows, ox: left, oy: top }, shiftX, shiftY };
  }

  const DOZE_TICK = 400;
  const LAYER_SIG_MAP = new WeakMap();

  function computeLayersFrameIdx(layers) {
    let key = '';
    for (let i = 0; i < layers.length; i++) {
      const l = layers[i];
      if (!l) continue;
      let sig = LAYER_SIG_MAP.get(l);
      if (sig === undefined) {
        sig = Array.isArray(l.rows)
          ? `${l.ox || 0},${l.oy || 0},${l.grounded ? 1 : 0}:${l.rows.join('/')}`
          : String(i);
        LAYER_SIG_MAP.set(l, sig);
      }
      key += (key ? '|' : '') + sig;
    }
    return key;
  }

  function renderPixelLayers(canvas, dpr, oxGrid, oyGrid, pxSize, palette, layers, options = {}) {
    const ctx = options.ctx || canvas._ctx || (canvas._ctx = canvas.getContext('2d'));
    if (!ctx) return;
    const cssW = canvas.width / dpr;
    const cssH = canvas.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.imageSmoothingEnabled = false;

    const mirror = !!options.mirror;
    // 垂直位移吸附到整格，保证方块网格不出现亚格错位
    const tyPx = round(Number(options.tyPx || 0) / pxSize) * pxSize;
    const rotDeg = Number(options.rotDeg || 0);
    const clipBottomY = options.clipBottomY;
    // 兼容旧入参 sxScale/syScale：换算为 16×10 画框上的整数格增量
    const sqW =
      options.sqW !== undefined ? round(options.sqW) : round(16 * (Number(options.sxScale || 1) - 1));
    const sqH =
      options.sqH !== undefined ? round(options.sqH) : round(10 * (Number(options.syScale || 1) - 1));

    const anchorX = (oxGrid + 8) * pxSize;
    const anchorY = (oyGrid + 10) * pxSize;

    const groundedLayers = [];
    const bodyLayers = [];
    const rigidLayers = [];
    for (const layer of layers) {
      if (!layer) continue;
      if (layer.grounded) groundedLayers.push(layer);
      else if (RIGID_LAYERS.has(layer)) rigidLayers.push(layer);
      else bodyLayers.push(layer);
    }

    // 弹性层最终列表：挤压时身体合成为一张整格点阵，道具/符号整格平移随行
    let elasticLayers;
    if ((sqW || sqH) && bodyLayers.length) {
      const sq = squashLayersToGrid(bodyLayers, sqW, sqH);
      if (sq) {
        elasticLayers = [sq.layer];
        for (const r of rigidLayers) {
          const w = max(1, ...r.rows.map((row) => row.length));
          // 左右边缘平移量取均值：加宽时居中符号保持居中，偏侧道具随该侧移动
          const dx = round((sq.shiftX(r.ox) + sq.shiftX(r.ox + w - 1)) / 2);
          const dy = sq.shiftY(r.oy + r.rows.length - 1);
          elasticLayers.push(shiftFrame(r, dx, dy));
        }
      }
    }
    if (!elasticLayers) elasticLayers = [...bodyLayers, ...rigidLayers];
    // 保持原有绘制顺序：身体部件 → 道具 → 符号（rigid 本就位于末尾）

    ctx.save();
    if (typeof clipBottomY === 'number' && isFn(ctx.clip)) {
      ctx.beginPath();
      if (isFn(ctx.rect)) {
        ctx.rect(0, 0, cssW, clipBottomY);
      } else {
        ctx.moveTo(0, 0);
        ctx.lineTo(cssW, 0);
        ctx.lineTo(cssW, clipBottomY);
        ctx.lineTo(0, clipBottomY);
        ctx.closePath();
      }
      ctx.clip();
    }

    // 地面/背景独立层（影子、火海衬底、生长节点、地面激光、立麦架）不随挤压或歪头旋转
    if (groundedLayers.length) {
      ctx.save();
      if (mirror) {
        ctx.translate(anchorX, 0);
        ctx.scale(-1, 1);
        ctx.translate(-anchorX, 0);
      }
      drawLayerSet(ctx, oxGrid, oyGrid, pxSize, palette, groundedLayers);
      ctx.restore();
    }

    const paintElastic = (c2) => {
      c2.save();
      c2.translate(0, tyPx);
      if (mirror) {
        const flipSet = [];
        const symSet = [];
        for (const l of elasticLayers) {
          if (SYM_LAYERS.has(l)) symSet.push(l);
          else flipSet.push(l);
        }
        c2.save();
        c2.translate(anchorX, 0);
        c2.scale(-1, 1);
        c2.translate(-anchorX, 0);
        drawLayerSet(c2, oxGrid, oyGrid, pxSize, palette, flipSet, options.colorResolver || null);
        if (isFn(options.overlayPainter)) {
          options.overlayPainter(c2, oxGrid, oyGrid, pxSize);
        }
        c2.restore();
        if (symSet.length) {
          const placed = symSet.map((s) => {
            const w = max(1, ...s.rows.map((r) => r.length));
            return { ...s, ox: 16 - (s.ox + w) };
          });
          drawLayerSet(c2, oxGrid, oyGrid, pxSize, palette, placed, options.colorResolver || null);
        }
      } else {
        drawLayerSet(c2, oxGrid, oyGrid, pxSize, palette, elasticLayers, options.colorResolver || null);
        if (isFn(options.overlayPainter)) {
          options.overlayPainter(c2, oxGrid, oyGrid, pxSize);
        }
      }
      if (isFn(options.rimPainter)) options.rimPainter(c2, cssW, oxGrid, oyGrid, pxSize);
      c2.restore();
    };

    if (!rotDeg) {
      paintElastic(ctx);
    } else {
      // 拖拽摆角：先在离屏画布上按整格绘制，再整体旋转贴图（关闭平滑，避免逐块缝隙与模糊）
      let off = canvas.__agRotOff;
      const docRef = canvas.ownerDocument;
      if (!off && docRef && isFn(docRef.createElement)) {
        off = docRef.createElement('canvas');
        canvas.__agRotOff = off;
      }
      const offCtx = off ? off._ctx || (off._ctx = off.getContext('2d')) : null;
      if (!offCtx) {
        ctx.translate(anchorX, anchorY);
        ctx.rotate((rotDeg * PI) / 180);
        ctx.translate(-anchorX, -anchorY);
        paintElastic(ctx);
      } else {
        if (off.width !== canvas.width || off.height !== canvas.height) {
          off.width = canvas.width;
          off.height = canvas.height;
        }
        offCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        offCtx.clearRect(0, 0, cssW, cssH);
        offCtx.imageSmoothingEnabled = false;
        paintElastic(offCtx);
        ctx.imageSmoothingEnabled = false;
        ctx.translate(anchorX, anchorY);
        ctx.rotate((rotDeg * PI) / 180);
        ctx.translate(-anchorX, -anchorY);
        ctx.drawImage(off, 0, 0, cssW, cssH);
      }
    }
    ctx.restore();
  }

  // 可被随机眨眼覆盖眼部的姿态；小紫猫慢摆尾的姿态
  const BLINKABLE_POSES = new Set(['idle', 'walk', 'lookNod', 'readAlong', 'gaze']);
  const SLOW_TAIL_POSES = new Set(['idle', 'lookNod', 'readAlong', 'gaze']);
  // 冰晶让位：头顶已有道具的姿态不挂冰晶；居中符号出现时冰晶暂隐，仅侧边汗滴与打盹 z 可共存
  const CRYSTAL_HIDE_POSES = new Set([
    'siren', 'onFire', 'cheerSticks', 'peek', 'flat', 'rickroll', 'carry', 'whaleSpout',
    'slashGoal', 'slashBoost', 'slashSchedule', 'slashGrill', 'slashLearnBulb',
  ]);
  const CRYSTAL_OK_SYMS = new Set([SYMS.sweat, SYMS.z1, SYMS.z2, SYMS.dozeZ0, SYMS.dozeZ1, SYMS.dozeZ2, SYMS.sleepBubble0, SYMS.sleepBubble1]);
  // 哈欠接伸懒腰：前 10 拍打哈欠，之后伸懒腰
  const YAWN_STRETCH_SPLIT = 10;

  // ── 紧凑数据驱动姿态配方引擎（24 个常规姿态走极简字符串表进入 LZ 池，复杂时间轴保留短函数）──
  const PLANT_STAGES_C = [[5, 'seed'], [9, 'p1'], [13, 'p2'], [17, 'p3'], [23, 'p4'], [27, 'wilt1'], [31, 'wilt2']];
  const PLANT_STAGES_K = [[5, 'seed'], [9, 'p1'], [13, 'p2'], [17, 'p3'], [23, 'p4']];
  const pickStage = (t, v, fb) => { for (const [lim, k] of t) if (v < lim) return k; return fb; };

  // DSL 字段码: 0=backProp sh=shadow b=body e=eyes l=legs L=clawL R=clawR a=ears w=paws t=tail m=mouth 1=prop1 2=prop2 y=extraSym(无sym时) Y=extraSym(强制) z=sink
  // 值后缀: ~f (frameMod?A:B), ~c (clipMod?A:B), ~4 (phase4), ~3 (tickIdx%3), ~l (lt%len), ~a-b (a<=lt<b?A:B); ~ 表示 null, 空串跳过; 前缀 C:/K:/S:/W:/N: 对应蟹/猫龙鲸/猫/鲸/非鲸
  const POSE_DSL_RAW =
    'flat:sh=w14,b=flat,e=flatEyes,l=~,C:L=flatLeft,C:R=flatRight,K:a=flat,K:w=~,K:t=curl|' +
    'dangle:sh=~,e=wide,l=dangle/flailA/dangle2/flailB~4,C:b=turnL/turnR~f,C:L=up,C:R=up,K:a=airplane,K:t=puff|' +
    'write:l=crouch,z=1,1=sheet,2=quill1/quill2~f,C:b=stand/turnR~f,C:R=write1/write2~f,K:a=stand/nod~f,K:w=write1/write2~f,K:t=sway/curl~f|' +
    'happy:e=happy,C:b=squash/stand~f,C:l=crouch/stand~f,C:L=up,C:R=up,K:a=nod/stand~f,K:w=cheer,K:t=up/puff~f|' +
    'pet:e=happy,C:b=squash/stand~f,C:l=crouch/stand~f,C:L=up,C:R=up,K:a=nod/stand~f,K:w=cheer,K:t=up/puff~f|' +
    'jiggle:l=flailA/flailB/flailC~3,e=happy,C:L=up,C:R=up,K:a=stand,K:t=puff|' +
    'peek:z=1,N:l=crouch,e=open/open/open/half~4,C:L=front,C:R=front,K:t=curl,W:e=peekOpen/peekOpen/peekOpen/loafHalf~4,W:w=tuck,W:t=loaf|' +
    'angry:b=squash/stand~f,l=walkA/walkB~f,C:e=squint,K:a=airplane,K:e=wide,K:t=puff|' +
    'groom:K:a=nod,K:e=shut,K:w=groom1/groom2~f|' +
    'tilt:b=turnL,e=half,K:a=nod,K:t=curl|' +
    'wow:e=wide,C:b=tall,C:L=up,C:R=up,K:a=stand,K:w=up,K:t=puff|' +
    'sulk:b=turnL,e=squint/shut~c,l=tuck,y=vein,C:L=front,C:R=front,K:a=airplane,K:t=curl|' +
    'polish:b=turnR,e=open/open/happy/open~4,1=mug,2=cloth1/cloth2~c,C:R=front,K:a=stand|' +
    'chaseDot:S:a=airplane,S:b=squash/stretch~c,S:e=wide,S:l=walkA/stand~c,S:t=puff,S:1=laser0/laser1/laser2~l,S:y=spark|' +
    'stretch:e=shut,y=tilde,C:b=tall,C:l=stand,C:L=up,C:R=up,K:a=stand,K:b=stretch,K:t=puff|' +
    'spinHop:b=turnR/stand/turnL/squash~4,e=open/open/open/happy~4,l=tuck/tuck/tuck/crouch~4,K:t=puff|' +
    'cheerSticks:b=squash/stand~f,l=crouch/stand~f,e=happy,1=stickLT/stickUp/stickRT/stickUp~4,2=stickRTM/stickUpM/stickLTM/stickUpM~4,y=note,C:L=up,C:R=up,K:a=stand/nod~c,K:w=up,K:t=puff|' +
    'chatGreet:b=stand/squash~c,e=happy,y=heart/note~c,C:L=up/stub~c,K:a=nod,K:t=up/puff~c|' +
    'balance:e=wide,C:L=open,C:R=open,K:a=airplane,K:w=cheer,K:t=puff|' +
    'worry:e=half/squint~c,l=tuck,y=sweat,C:L=front,C:R=front,K:a=airplane,K:t=curl|' +
    'salute:e=happy,y=spark,C:R=up,K:a=stand,K:w=upR,K:t=up|' +
    'carry:C:e=up,C:L=open,C:R=open|' +
    'eat:C:b=stand/squash~23-,K:b=stand/squash~21-,C:l=stand/crouch~23-,K:l=stand/crouch~21-,C:e=half/open~c,C:e=happy/~23-,K:e=happy/half~21-,C:1=bowlEmpty/bowl~21-,K:1=bowlEmpty/bowl~19-,2=chop2/chop1~c,C:2=~/~21-,K:2=~/~19-,C:Y=heart/~23-,K:Y=heart/~21-,K:a=nod|' +
    'eatFish:b=stand/squash~21-,l=stand/crouch~21-,C:e=half,K:e=half/open~c,e=happy/~21-,1=fishBone/fishDish~19-,Y=heart/~21-,K:a=stand/nod~21-,K:t=sway/up~c|' +
    'catStretch:S:a=loaf/nod~18-,S:b=loaf/stretch~18-,S:e=loafHalf/shut~18-,S:l=~/~18-,S:t=loaf/up~18-,S:Y=z1/tilde~18-|' +
    'dragonFlame:b=turnR,e=happy/happy/happy/happy/squint/squint~l,m=small,1=dragonFlame0/dragonFlame1/dragonFlame2~l,y=fireSpark0/fireSpark1/fireSpark2~l,K:a=airplane,K:w=up/cheer~c,K:t=puff,C:L=up,C:R=front|' +
    'whaleSpout:b=squash/stand~c,N:l=crouch/stand~c,W:l=~,e=happy,1=whaleSpout0/whaleSpout1/whaleSpout2~l,K:a=nod/stand~c,K:w=cheer/up~c,K:t=puff,C:L=up,C:R=up|' +
    'letter:b=turnR,e=open,e=half/~10-19,e=happy/~19-,1=envS/letter~0-6,1=envSOpen/~6-11,Y=heart/~19-,K:a=nod|' +
    'rickroll:b=leanR/squash/leanL/stand~4,e=happy/open~c,1=micStand/micSink1~0-31,1=micSink2/~34-,y=note,K:a=stand/nod~c,K:w=cheer,C:L=up/stub~c,C:R=stub/up~c|' +
    'readAlong:e=open/open/half/half~l,e=open/~0-2,e=open/~14-,z=0/0/1/1~l,z=0/~0-2,z=0/~14-,N:l=stand/stand/crouch/crouch~l,N:l=stand/~0-2,N:l=stand/~14-,C:y=note|' +
    'yawn:e=half,e=shut/~2-9,m=small/~0-2,m=yawn/~2-9,y=tilde/~4-9,K:a=nod/~0-9,K:t=puff/~2-9,K:t=curl/~9-,C:b=tall/~2-9,C:L=up/~2-9,C:R=up/~2-9|' +
    'wave:e=happy,K:a=nod,K:w=upR/upR/none/none~l,K:w=none/~12-,K:y=note,C:R=up/up/waveOut/waveOut~l,C:R=stub/~12-,C:y=note/heart~0-12|' +
    'slashPlan:b=turnR,1=blueprint,e=happy/open~14-,z=1/~8-11,l=crouch/~8-11,y=spark/note~14-,K:a=nod,K:w=write1,K:t=sway,C:R=front|' +
    'slashGoal:0=goalFlame1/goalFlame0~c,b=squash/stand~0-8,l=crouch/stand~0-8,e=happy/squint~14-,1=headband,y=spark,K:a=nod/stand~0-8,K:w=cheer/up~0-8,K:t=puff,C:L=front/up~0-8,C:R=front/up~0-8|' +
    'slashBoost:e=wide,1=goggles,2=iceCrystal/iceCrystalSpin/iceCrystalHi/iceCrystalSpin~4,y=spark,K:a=stand,K:w=up,K:t=puff,C:L=up,C:R=up|' +
    'slashTeam:e=happy,1=flag0/flag1~c,y=spark,C:R=up,K:a=stand,K:w=upR,K:t=puff|' +
    'slashBrowser:0=waveSplash1/waveSplash0~c,b=leanR/turnR~c,1=shadesProp,2=surfboard,y=spark,K:a=airplane,K:t=puff|' +
    'slashCompact:b=squash/leanR~c,b=stand/~16-,l=crouch/stand~c,l=stand/~16-,e=happy/squint~16-,1=cloudBig/cubeGlow~0-9,1=cloudMid/~9-16,y=spark/~16-,K:a=stand/nod~16-,K:w=up/cheer~16-,K:t=puff/sway~16-,C:L=up/front~16-,C:R=up/front~16-|' +
    'slashSchedule:1=hourglass1/hourglass0~c,2=pocketWatch,e=half/open~c,e=happy/~10-14,z=1/~10-14,l=crouch/~10-14,y=note,K:a=nod,K:t=sway,C:R=front|' +
    'slashGrill:e=squint,1=spotlight,2=micHand,y=q,C:R=front,K:a=nod,K:w=write1,K:t=curl|' +
    'slashLearnBook:e=half/open~c,1=book0/book1~c,y=note,C:R=front,K:a=nod,K:w=write1,K:t=sway|' +
    'slashLearnBulb:1=bulbOn/bulbOff~9-,e=happy/half~9-,y=spark/q~9-,K:a=stand/nod~9-,K:t=puff/curl~9-,C:R=up/~9-|' +
    'nightSip:e=half/happy~c,1=hotCup0/hotCup1~c,y=tilde,C:R=front,K:a=nod,K:t=curl|' +
    'feedCoffee:e=happy,1=hotCup0/hotCup1~c,y=heart,C:R=front,K:a=nod/stand~f,K:t=up/puff~f|' +
    'feedDonut:b=squash/stand~c,l=crouch/stand~c,e=happy,1=donut0/donut1~0-10,y=heart,K:a=nod/stand~c,K:t=up/puff~c,C:R=front';

  const DSL_KEY_MAP = { 0: 'backProp', sh: 'shadow', b: 'body', e: 'eyes', l: 'legs', L: 'clawL', R: 'clawR', a: 'ears', w: 'paws', t: 'tail', m: 'mouth', 1: 'prop1', 2: 'prop2', y: 'extraSym', Y: 'forceSym', z: 'sink' };
  const POSE_DSL = Object.create(null);
  for (const seg of POSE_DSL_RAW.split('|')) {
    const idx = seg.indexOf(':');
    POSE_DSL[seg.slice(0, idx)] = seg.slice(idx + 1).split(',').map((kv) => {
      let scope = '';
      let rest = kv;
      if (rest[1] === ':') { scope = rest[0]; rest = rest.slice(2); }
      const eq = rest.indexOf('=');
      const prop = DSL_KEY_MAP[rest.slice(0, eq)];
      const rawV = rest.slice(eq + 1);
      if (rawV === '~') return [scope, prop, 0, null];
      const tIdx = rawV.lastIndexOf('~');
      if (tIdx >= 0) {
        const m = rawV.slice(tIdx + 1);
        const parts = rawV.slice(0, tIdx).split('/').map((x) => (x === '~' ? null : x));
        const di = m.indexOf('-');
        return [scope, prop, di >= 0 ? [+m.slice(0, di), m.slice(di + 1) ? +m.slice(di + 1) : 1e9] : m, parts];
      }
      return [scope, prop, 0, prop === 'sink' ? +rawV : rawV];
    });
  }

  function applyDslPose(s, rules, c) {
    for (const [sc, prop, mode, val] of rules) {
      if (sc && (sc === 'C' ? c.isFelineRig : sc === 'K' ? !c.isFelineRig : sc === 'S' ? !c.isCat : sc === 'W' ? !c.isWhale : c.isWhale)) continue;
      let v = val;
      if (mode) {
        if (Array.isArray(mode)) v = val[c.lt >= mode[0] && c.lt < mode[1] ? 0 : 1];
        else if (mode === 'f') v = val[c.frameMod ? 0 : 1];
        else if (mode === 'c') v = val[c.clipMod ? 0 : 1];
        else if (mode === '4') v = val[c.phase4];
        else if (mode === '3') v = val[c.tickIdx % 3];
        else if (mode === 'l') v = val[c.lt % val.length];
        if (v === '') continue;
      }
      if (prop === 'extraSym') { if (!c.sym) s.extraSym = v; }
      else if (prop === 'forceSym') s.extraSym = v;
      else s[prop] = prop === 'sink' && v !== null ? +v : v;
    }
  }

  const POSE_RECIPES = {
    idle: null,
    squash(s, { isFelineRig, isWhale, p }) {
      s.shadow = 'w14'; s.body = 'squash'; s.legs = isWhale ? null : 'crouch';
      if (isFelineRig) { s.ears = 'nod'; s.eyes = 'half'; if (isWhale) s.paws = 'tuck'; } else s.eyes = shiftFrame(p.eyes.squint, 0, 1);
    },
    loaf(s, { isCat, isWhale, poseKey, phase4, tickIdx }) {
      if (!isCat && !isWhale) return;
      s.shadow = 'w14'; s.ears = 'loaf'; s.body = 'loaf'; s.legs = null;
      if (isWhale) s.paws = 'tuck';
      s.eyes = poseKey === 'sleep' || phase4 === 3 ? 'loafShut' : 'loafHalf';
      s.tail = poseKey === 'sleep' || isWhale ? 'loaf' : floor(tickIdx / 4) % 2 ? 'loaf' : 'curl';
    },
    sleep(s, c) {
      if (c.isCat || c.isWhale) POSE_RECIPES.loaf(s, c);
      else if (c.isDragon) { s.shadow = 'w14'; s.body = 'squash'; s.ears = 'loaf'; s.eyes = 'shut'; s.legs = 'tuck'; s.paws = 'tuck'; s.tail = 'curl'; }
      else { s.body = 'squash'; s.eyes = 'shut'; s.legs = 'tuck'; }
    },
    walk(s, { isCat, isDragon, isWhale, tickIdx, opts }) {
      const b = floor(tickIdx / 2) % 4;
      if (isWhale) {
        s.legs = null;
        if (b % 2 === 0) s.sink = -1;
        s.body = opts.dir === 'left' ? 'turnL' : 'turnR';
        s.paws = b < 2 ? 'flap' : 'none';
        s.tail = b < 2 ? 'puff' : 'sway';
        return;
      }
      s.legs = ['walkA', 'stand', 'walkB', 'stand'][b];
      if (b % 2 === 0) s.sink = 1;
      if (isCat) s.tail = b < 2 ? 'up' : 'sway';
      else if (isDragon) {
        s.body = opts.dir === 'left' ? 'turnL' : 'turnR';
        s.paws = b % 2 === 0 ? 'cheer' : 'none';
        s.tail = b < 2 ? 'up' : 'sway';
      } else s.body = opts.dir === 'left' ? 'turnL' : 'turnR';
    },
    plant(s, { isFelineRig, lt, sym, p }) {
      s.legs = lt < 8 ? 'crouch' : 'stand';
      if (isFelineRig) {
        s.ears = 'nod'; s.body = lt < 8 ? 'squash' : 'stand'; s.eyes = lt >= 16 && lt <= 24 ? 'happy' : 'open';
        s.prop1 = pickStage(PLANT_STAGES_K, lt, 'wilt2'); s.prop2 = lt >= 17 && lt < 21 ? 'd1' : null;
      } else {
        s.body = lt < 8 ? 'squash2' : 'stand'; s.clawR = lt < 8 ? 'low' : 'stub';
        s.eyes = lt < 8 ? shiftFrame(p.eyes.open, 0, 3) : lt >= 16 && lt <= 24 ? 'happy' : lt > 24 ? 'half' : 'open';
        s.prop1 = pickStage(PLANT_STAGES_C, lt, 'wilt3');
        s.prop2 = lt >= 17 && lt < 21 ? 'd1' : lt >= 21 && lt < 23 ? 'd2' : null;
        s.extraSym = lt > 28 ? SYMS.sweat : sym;
      }
    },
    butterfly(s, { isFelineRig, lt, clipMod, sym }) {
      const lp = lt % 16 >= 8, r = lt >= 24 && lt <= 30;
      s.eyes = r ? 'happy' : lp ? 'openL' : 'openR';
      s.prop1 = r ? 'bfRest' : lp ? (clipMod ? 'bfLeftUp' : 'bfLeftDn') : clipMod ? 'bfUp' : 'bfDn';
      s.extraSym = r ? SYMS.spark : sym;
      if (isFelineRig) { s.ears = r ? 'nod' : 'stand'; s.tail = clipMod ? 'sway' : 'puff'; } else s.clawR = lt % 10 < 5 ? 'reach1' : 'stub';
    },
    onFire(s, { lt }) {
      const cool = lt >= 30;
      s.backProp = cool ? null : 'fire' + (lt < 5 ? 1 : lt < 10 ? 2 : 3) + (lt % 4);
      s.prop1 = 'mug'; s.eyes = 'open'; s.extraSym = cool ? PROPS.smoke : SYMS['fireSpark' + (lt % 3)];
    },
    siren(s, { isFelineRig, lt, clipMod }) {
      const x = floor(lt / 6) % 2 ? 'B' : '', i = lt % 4, bn = ['beamL', 'beamF', 'beamR', null][i];
      s.body = clipMod ? 'squash' : 'stand'; s.eyes = 'wide';
      s.prop1 = ['sirenL', 'sirenF', 'sirenR', 'sirenDim'][i] + x; s.prop2 = bn ? bn + x : null;
      s.extraSym = clipMod ? SYMS.bang : SYMS.sweat; if (isFelineRig) s.ears = 'airplane';
    },
    lookNod(s, { isFelineRig, lt, opts, sym }) {
      const fL = opts.dir === 'left', at = Number(opts.clipParam ?? (isFelineRig ? 9 : 5)), nod = lt >= at && lt < at + 2;
      s.body = fL ? 'turnL' : 'turnR'; s.eyes = nod ? 'happy' : fL ? 'openL' : 'openR';
      if (nod) { s.sink = 1; s.legs = 'crouch'; }
      s.extraSym = sym || (lt >= at + 2 && lt < at + 8 ? (isFelineRig ? SYMS.heart : SYMS.note) : null);
    },
    gaze(s, { isCat, isDragon, opts }) {
      const fL = opts.dir === 'left', up = opts.clipParam === 1;
      s.body = fL ? 'turnL' : 'turnR'; s.eyes = up ? (fL ? 'upL' : 'upR') : fL ? 'openL' : 'openR';
      if ((isCat || isDragon) && (opts.earTwitch === 'L' || opts.earTwitch === 'R')) s.ears = opts.earTwitch === 'L' ? 'twitchL' : 'twitchR';
    },
  };

  const ALL_POSE_KEYS = Array.from(new Set([...Object.keys(POSE_DSL), ...Object.keys(POSE_RECIPES), 'yawnStretch']));

  function resolvePart(dict, val) {
    return typeof val === 'string' ? dict[val] || null : val || null;
  }

  function buildClipLayers(kind, poseKey, tickIdx, opts = {}) {
    if (poseKey === 'yawnStretch') {
      const lt = Number(opts.clipTick ?? tickIdx);
      const first = lt < YAWN_STRETCH_SPLIT;
      return buildClipLayers(kind, first ? 'yawn' : 'stretch', tickIdx, {
        ...opts,
        clipTick: first ? lt : lt - YAWN_STRETCH_SPLIT,
      });
    }
    const isCat = kind === 'cat';
    const isDragon = kind === 'dragon';
    const isWhale = kind === 'whale';
    const isFelineRig = isCat || isDragon || isWhale;
    const p = isCat ? CAT_PARTS : isDragon ? DRAGON_PARTS : isWhale ? WHALE_PARTS : CLAWD_PARTS;
    const frameMod = tickIdx % 2;
    const phase4 = tickIdx % 4;
    const sym = opts.sym ? SYMS[opts.sym] : null;
    const lt = Number(opts.clipTick ?? tickIdx);
    const clipMod = lt % 2;
    const blinkStage = opts.blinkStage || (opts.blink ? 'closed' : null);

    const s = {
      backProp: null,
      shadow: opts.noShadow ? null : 'w12',
      body: 'stand',
      eyes: opts.eyeScan === -1 ? 'openL' : opts.eyeScan === 1 ? 'openR' : 'open',
      legs: isWhale ? null : 'stand',
      mouth: null,
      prop1: null,
      prop2: null,
      extraSym: sym,
      sink: 0,
      clawL: isFelineRig ? null : 'stub',
      clawR: isFelineRig ? null : 'stub',
      ears: isFelineRig ? 'stand' : null,
      paws: isFelineRig ? 'none' : null,
      tail: isFelineRig ? ['up', 'sway', 'curl', 'up'][phase4] : null,
    };

    const ctx = { isCat, isDragon, isWhale, isFelineRig, p, poseKey, tickIdx, lt, frameMod, clipMod, phase4, opts, sym };
    if (hasOwn(POSE_RECIPES, poseKey)) {
      if (POSE_RECIPES[poseKey]) POSE_RECIPES[poseKey](s, ctx);
    } else if (POSE_DSL[poseKey]) {
      applyDslPose(s, POSE_DSL[poseKey], ctx);
    }

    if (isFelineRig && s.body === 'squash' && s.ears === 'stand') s.ears = 'nod';
    if (isDragon && (poseKey === 'happy' || poseKey === 'pet')) s.paws = frameMod ? 'up' : 'cheer';
    if (isDragon && poseKey === 'peek') s.paws = 'tuck';
    if (isWhale && (poseKey === 'happy' || poseKey === 'pet') && !s.prop1) s.prop1 = frameMod ? 'whaleSpout1' : 'whaleSpout0';
    if (isWhale && poseKey === 'flat') s.tail = 'loaf';
    if (isFelineRig && SLOW_TAIL_POSES.has(poseKey)) {
      s.tail = opts.reduced ? 'up' : floor(tickIdx / 3) % 2 ? 'sway' : 'up';
    }
    if (poseKey === 'idle') {
      if (isCat) {
        if (opts.earTwitch === 'L') s.ears = 'twitchL';
        else if (opts.earTwitch === 'R') s.ears = 'twitchR';
      } else if (isDragon) {
        if (opts.earTwitch === 'L') s.ears = 'twitchL';
        else if (opts.earTwitch === 'R') s.ears = 'twitchR';
        if (opts.clawSnap) s.paws = 'cheer';
      } else if (isWhale) {
        if (opts.earTwitch) s.tail = 'puff';
        if (opts.clawSnap) s.paws = 'flap';
      } else {
        if (opts.clawSnap === 'L') s.clawL = 'open';
        else if (opts.clawSnap === 'R') s.clawR = 'open';
      }
      if (opts.breath) {
        s.sink = 1;
        if (!isWhale) s.legs = 'crouch';
        if (s.shadow) s.shadow = 'w14';
      }
    }
    if (isWhale && s.sink > 0) {
      if (s.body === 'stand') s.body = 'squash';
      s.sink = 0;
    }

    let backProp = resolvePart(PROPS, s.backProp);
    let shadow = resolvePart(p.shadow, s.shadow);
    let legs = resolvePart(p.legs, s.legs);
    let body = resolvePart(p.body, s.body);
    let mouth = resolvePart(p.mouth, s.mouth);
    let eyes = resolvePart(p.eyes, s.eyes);
    let prop1 = resolvePart(PROPS, s.prop1);
    let prop2 = resolvePart(PROPS, s.prop2);
    let extraSym = resolvePart(SYMS, s.extraSym) || (typeof s.extraSym === 'object' ? s.extraSym : null);

    if (blinkStage && BLINKABLE_POSES.has(poseKey)) {
      const eyeDx = eyes === p.eyes.open ? 0 : eyes === p.eyes.openL ? -1 : eyes === p.eyes.openR ? 1 : null;
      if (eyeDx !== null) eyes = shiftFrame(blinkStage === 'half' ? p.eyes.half : p.eyes.blink, eyeDx, 0);
    }

    if (!isFelineRig) {
      let clawL = resolvePart(p.clawL, s.clawL);
      let clawR = resolvePart(p.clawR, s.clawR);
      if (s.body === 'squash') {
        if (clawL === p.clawL.up) clawL = shiftFrame(clawL, 0, 2);
        if (clawR === p.clawR.up) clawR = shiftFrame(clawR, 0, 2);
      }
      if (s.sink) {
        body = shiftFrame(body, 0, s.sink);
        eyes = shiftFrame(eyes, 0, s.sink);
        clawL = shiftFrame(clawL, 0, s.sink);
        clawR = shiftFrame(clawR, 0, s.sink);
        mouth = shiftFrame(mouth, 0, s.sink);
      }
      let crystal = null;
      if (opts.crystal && !CRYSTAL_HIDE_POSES.has(poseKey) && !(extraSym && !CRYSTAL_OK_SYMS.has(extraSym))) {
        crystal = opts.crystalBob ? PROPS.iceCrystalHi : PROPS.iceCrystal;
      }
      return [backProp, shadow, legs, body, mouth, eyes, clawL, clawR, prop1, prop2, crystal, extraSym].filter(Boolean);
    }

    let ears = resolvePart(p.ears, s.ears);
    let paws = resolvePart(p.paws, s.paws);
    let tail = resolvePart(p.tail, s.tail);
    if (s.sink) {
      body = shiftFrame(body, 0, s.sink);
      ears = shiftFrame(ears, 0, s.sink);
      eyes = shiftFrame(eyes, 0, s.sink);
      paws = shiftFrame(paws, 0, s.sink);
      tail = shiftFrame(tail, 0, s.sink);
      mouth = shiftFrame(mouth, 0, s.sink);
    }
    return [backProp, shadow, tail, legs, body, mouth, ears, eyes, paws, prop1, prop2, extraSym].filter(Boolean);
  }

  // 随机眨眼过渡：1×2 竖瞳 → 1×1 → 闭（s 暗面横线）→ 1×1 → 1×2
  const BLINK_SINGLE = ['half', 'closed', 'half'];
  const BLINK_DOUBLE = ['half', 'closed', 'half', 'closed', 'half'];
  // 迷你蟹眨眼帧缓存：把竖瞳 o 替换为暗面色 s
  const MINI_BLINK_CACHE = new WeakMap();
  function miniBlinkFrame(fr) {
    let out = MINI_BLINK_CACHE.get(fr);
    if (!out) {
      out = recolorFrame(fr, { o: 's' });
      MINI_BLINK_CACHE.set(fr, out);
    }
    return out;
  }

  // ── 纯几何碰撞与擦肩经过判定（供主宠自主散步 / 拖拽 / 单元契约共测） ──
  const CRAB_ENCOUNTER_SEQ = new WeakMap();

  function classifyPairEncounter(opts = {}) {
    const {
      xA = 0,
      yA = 0,
      walkingA = false,
      dirA = 1,
      xB = 0,
      yB = 0,
      walkingB = false,
      dirB = -1,
      contactDist = 42,
      verticalTol = 22,
    } = opts;
    if (abs(yA - yB) > verticalTol) return null;
    const dx = xB - xA;
    if (abs(dx) >= contactDist) return null;
    if (!walkingA && !walkingB) return null;
    const sign = dx >= 0 ? 1 : -1;
    const dA = dirA >= 0 ? 1 : -1;
    const dB = dirB >= 0 ? 1 : -1;

    // 1. 双向相向逼近 → 迎面轻撞 (bump)
    if (walkingA && walkingB && dA * sign > 0 && dB * sign < 0) {
      return { kind: 'bump', sign };
    }
    // 2. 单方朝静止伙伴靠近且尚未完全跨过 → 擦肩经过 (passBy)
    if (walkingA && !walkingB && dA * sign > 0 && abs(dx) >= 10) {
      return { kind: 'passBy', mover: 'A', stationary: 'B', dir: dA };
    }
    if (walkingB && !walkingA && dB * sign < 0 && abs(dx) >= 10) {
      return { kind: 'passBy', mover: 'B', stationary: 'A', dir: dB };
    }
    // 3. 同向行走且后方追上前车 → 超车擦肩经过 (passBy)
    if (walkingA && walkingB && dA === dB && abs(dx) >= 8) {
      const rearIsA = dA > 0 ? xA < xB : xA > xB;
      return {
        kind: 'passBy',
        mover: rearIsA ? 'A' : 'B',
        stationary: rearIsA ? 'B' : 'A',
        dir: dA,
      };
    }
    return null;
  }

  // ── 迷你三蟹舞台走廊漫步与碰钳/翻越经过逻辑 ─────────────────────────────
  function stepMiniCrabCorridor(crabs, opts = {}) {
    const minX = isFin(opts.minX) ? opts.minX : 2;
    const maxX = max(minX + 16, isFin(opts.maxX) ? opts.maxX : 220);
    const contactDist = isFin(opts.contactDist) ? opts.contactDist : 26;
    const nowTick = isFin(opts.nowTick) ? opts.nowTick : 0;
    const events = [];
    if (!Array.isArray(crabs) || crabs.length === 0) return events;

    let pairCounts = CRAB_ENCOUNTER_SEQ.get(crabs);
    if (!pairCounts) {
      pairCounts = new Map();
      CRAB_ENCOUNTER_SEQ.set(crabs, pairCounts);
    }

    // 1. 自由状态下的迷你蟹匀速漫步 + 走廊边界折返
    for (const mc of crabs) {
      if (!mc || mc.act) continue;
      if (!isFin(mc.px)) mc.px = isFin(mc.x) ? mc.x : minX;
      if ((mc.bumpUntilTick || -1) > nowTick) {
        mc.px = clamp(mc.px, minX, maxX);
        continue;
      }
      const spd = isFin(mc.speed) ? mc.speed : 1.0;
      mc.dir = mc.dir >= 0 ? 1 : -1;
      let next = mc.px + mc.dir * spd;
      if (next <= minX) {
        next = minX;
        mc.dir = 1;
      } else if (next >= maxX) {
        next = maxX;
        mc.dir = -1;
      }
      mc.px = next;
    }

    // 2. 两两检测接触：迎面交替触发 crabBump / crabPass；同向追及触发 crabPass
    for (let i = 0; i < crabs.length; i++) {
      const a = crabs[i];
      if (!a || a.act || (a.cooldownTick || -99) > nowTick) continue;
      for (let j = i + 1; j < crabs.length; j++) {
        const b = crabs[j];
        if (!b || b.act || (b.cooldownTick || -99) > nowTick) continue;
        const dx = b.px - a.px;
        if (abs(dx) >= contactDist) continue;
        const sign = dx >= 0 ? 1 : -1;
        const dA = a.dir >= 0 ? 1 : -1;
        const dB = b.dir >= 0 ? 1 : -1;
        const headOn = dA * sign > 0 && dB * sign < 0;
        const sameDirChase = dA === dB && abs(dx) >= 4;
        if (!headOn && !sameDirChase) continue;

        if (headOn) {
          const pairKey = [a.id, b.id].sort().join('-');
          const count = pairCounts.get(pairKey) || 0;
          pairCounts.set(pairKey, count + 1);
          if (count % 2 === 0) {
            a.px = clamp(a.px - sign * 3, minX, maxX);
            b.px = clamp(b.px + sign * 3, minX, maxX);
            a.dir = -sign;
            b.dir = sign;
            a.bumpUntilTick = nowTick + 3;
            b.bumpUntilTick = nowTick + 3;
            a.cooldownTick = nowTick + 8;
            b.cooldownTick = nowTick + 8;
            events.push({ type: 'crabBump', pair: `${a.id}-${b.id}` });
          } else {
            const vaulter = a;
            const yielded = b;
            vaulter.px = clamp(vaulter.px + vaulter.dir * 8, minX, maxX);
            vaulter.passHopUntilTick = nowTick + 4;
            yielded.blinkAt = nowTick;
            a.cooldownTick = nowTick + 9;
            b.cooldownTick = nowTick + 9;
            events.push({ type: 'crabPass', pair: `${vaulter.id}-${yielded.id}` });
          }
        } else {
          const rearIsA = dA > 0 ? a.px < b.px : a.px > b.px;
          const vaulter = rearIsA ? a : b;
          const yielded = rearIsA ? b : a;
          vaulter.px = clamp(vaulter.px + vaulter.dir * 8, minX, maxX);
          vaulter.passHopUntilTick = nowTick + 4;
          yielded.blinkAt = nowTick;
          a.cooldownTick = nowTick + 9;
          b.cooldownTick = nowTick + 9;
          events.push({ type: 'crabPass', pair: `${vaulter.id}-${yielded.id}` });
        }
        break;
      }
    }
    return events;
  }

  // ── Google 四色全息棱镜虹彩光谱插值 & 5 宠一维刚体防重叠 & 遇障决策纯函数 ──────
  const CHROMA_STOPS = [
    [0x42, 0x85, 0xf4], // #4285F4 Cobalt Blue
    [0x9b, 0x72, 0xcb], // #9B72CB Amethyst Iris
    [0xea, 0x43, 0x35], // #EA4335 Coral Red
    [0xfb, 0xbc, 0x04], // #FBBC04 Warm Amber
    [0x5c, 0xc6, 0xfc], // #5CC6FC Sky Cyan
  ];
  const CHROMA_HEX = ['#4285F4', '#9B72CB', '#EA4335', '#FBBC04', '#5CC6FC'];

  const CHROMA_CACHE = Object.create(null);

  function evalChromaColorAt(gx, gy, phase = 0, isShadow = false) {
    const sum = gx + gy;
    const pNorm = ((phase % 1) + 1) % 1;
    const pStep = round(pNorm * 12);
    const cacheable = Number.isInteger(sum) && sum >= -64 && sum <= 128 && abs(pNorm * 12 - pStep) < 1e-5;
    let cKey = 0;
    if (cacheable) {
      cKey = ((pStep % 12) << 9) | ((sum + 64) << 1) | (isShadow ? 1 : 0);
      const hit = CHROMA_CACHE[cKey];
      if (hit) return hit;
    }
    const raw = (sum * 0.068 - (cacheable ? (pStep % 12) / 12 : phase)) % 1;
    const u = (raw < 0 ? raw + 1 : raw) * CHROMA_STOPS.length;
    const i0 = floor(u) % CHROMA_STOPS.length;
    const i1 = (i0 + 1) % CHROMA_STOPS.length;
    const t = u - floor(u);
    const s = t * t * (3 - 2 * t);
    const c0 = CHROMA_STOPS[i0];
    const c1 = CHROMA_STOPS[i1];
    let r = c0[0] + (c1[0] - c0[0]) * s;
    let g = c0[1] + (c1[1] - c0[1]) * s;
    let b = c0[2] + (c1[2] - c0[2]) * s;
    if (isShadow) {
      r = r * 0.68 + 18 * 0.14;
      g = g * 0.68 + 22 * 0.14;
      b = b * 0.72 + 40 * 0.14;
    }
    const hex = (v) => clamp(round(v), 0, 255).toString(16).padStart(2, '0');
    const out = `#${hex(r)}${hex(g)}${hex(b)}`;
    if (cacheable) CHROMA_CACHE[cKey] = out;
    return out;
  }

  /**
   * 一维地面刚体防重叠与向空旷侧推挤分离求解器
   * 输入 bodies: Array<{ id: string, cx: number, halfW: number, locked?: boolean }>
   * 原地更新每个非 locked 角色的 cx，保证净间距 >= minGap（默认 6px）
   */
  function resolveGroundSeparation(bodies, stageMinX = 12, stageMaxX = 708, minGap = 6) {
    if (!Array.isArray(bodies) || bodies.length < 2) {
      if (Array.isArray(bodies) && bodies.length === 1 && !bodies[0].locked) {
        const b = bodies[0];
        b.cx = clamp(b.cx, stageMinX + b.halfW, stageMaxX - b.halfW);
      }
      return bodies;
    }
    const span = max(40, stageMaxX - stageMinX);
    const totalHalfW = bodies.reduce((s, b) => s + b.halfW * 2, 0);
    const maxFeasibleGap = bodies.length > 1 ? max(0, (span - totalHalfW) / (bodies.length - 1)) : minGap;
    const effGap = min(minGap, maxFeasibleGap);

    const ordered = bodies
      .map((b, idx) => ({ b, idx }))
      .sort((a, z) => (abs(a.b.cx - z.b.cx) > 0.01 ? a.b.cx - z.b.cx : a.idx - z.idx))
      .map((x) => x.b);

    for (const b of ordered) {
      if (!b.locked) {
        b.cx = clamp(b.cx, stageMinX + b.halfW, stageMaxX - b.halfW);
      }
    }

    for (let iter = 0; iter < 6; iter++) {
      let moved = false;
      for (let i = 0; i < ordered.length - 1; i++) {
        const left = ordered[i];
        const right = ordered[i + 1];
        const req = left.halfW + right.halfW + effGap;
        const dist = right.cx - left.cx;
        if (dist >= req - 0.01) continue;
        const overlap = req - dist;
        moved = true;
        if (left.locked && right.locked) continue;
        if (left.locked) {
          right.cx += overlap;
        } else if (right.locked) {
          left.cx -= overlap;
        } else {
          const leftRoom = max(0, left.cx - left.halfW - stageMinX);
          const rightRoom = max(0, stageMaxX - (right.cx + right.halfW));
          const sumRoom = leftRoom + rightRoom;
          const wRight = sumRoom > 1 ? rightRoom / sumRoom : 0.5;
          left.cx -= overlap * (1 - wRight);
          right.cx += overlap * wRight;
        }
        if (!left.locked) left.cx = clamp(left.cx, stageMinX + left.halfW, stageMaxX - left.halfW);
        if (!right.locked) right.cx = clamp(right.cx, stageMinX + right.halfW, stageMaxX - right.halfW);
      }
      // 二次单向扫掠消除靠墙挤压残余
      for (let i = 0; i < ordered.length - 1; i++) {
        const l = ordered[i];
        const r = ordered[i + 1];
        const req = l.halfW + r.halfW + effGap;
        if (r.cx - l.cx < req && !r.locked) {
          r.cx = min(stageMaxX - r.halfW, l.cx + req);
        }
      }
      for (let i = ordered.length - 1; i > 0; i--) {
        const l = ordered[i - 1];
        const r = ordered[i];
        const req = l.halfW + r.halfW + effGap;
        if (r.cx - l.cx < req && !l.locked) {
          l.cx = max(stageMinX + l.halfW, r.cx - req);
        }
      }
      if (!moved) break;
    }
    return bodies;
  }

  /**
   * 散步遇障三种灵动越障决策器：
   * - 'leapfrog': 抛物线撑跳越过对方头顶（峰值 ~26px）落到另一侧继续走
   * - 'autoPerch': 顺势轻跳坐上对方（或塔顶）头顶搭便车
   * - 'greetTurn': 驻足眨眼/拉墨镜偷瞄/挥魔杖闪星后礼貌转身
   */
  function chooseObstacleAction(opts = {}) {
    const canLeap = opts.canLeap !== false;
    const canPerch = !!opts.canPerch;
    const roll = isFin(opts.roll) ? opts.roll : random();
    if (canLeap && canPerch) {
      if (roll < 0.42) return 'leapfrog';
      if (roll < 0.74) return 'autoPerch';
      return 'greetTurn';
    }
    if (canLeap) return roll < 0.58 ? 'leapfrog' : 'greetTurn';
    if (canPerch) return roll < 0.52 ? 'autoPerch' : 'greetTurn';
    return 'greetTurn';
  }

  // ── 自由点选桌宠阵容编解码（向后兼容 5 预设 + dual 别名，单物种纯开关 0/1，主宠总数 <= 4，旧多数量自动夹紧）──
  const MASCOT_SPECIES_ORDER = ['c', 'k', 'd', 'w'];
  const MASCOT_MAX_PER_SPECIES = 1;
  const MASCOT_MAX_TOTAL = 4;
  const MASCOT_PRESET_MAP = {
    off: { c: 0, k: 0, d: 0, w: 0, minis: false },
    crab: { c: 1, k: 1, d: 0, w: 0, minis: false },
    dual: { c: 1, k: 1, d: 0, w: 0, minis: false },
    minis: { c: 1, k: 1, d: 0, w: 0, minis: true },
    quad: { c: 1, k: 1, d: 1, w: 1, minis: false },
    'quad-minis': { c: 1, k: 1, d: 1, w: 1, minis: true },
  };

  function parseMascotSpec(raw) {
    if (raw === false) return { c: 0, k: 0, d: 0, w: 0, minis: false };
    if (typeof raw !== 'string') return null;
    if (hasOwn(MASCOT_PRESET_MAP, raw)) return { ...MASCOT_PRESET_MAP[raw] };
    if (!raw.startsWith('r:') || raw.length <= 2) return null;
    const m = /^r:(?:([ckdw][0-4](?:,[ckdw][0-4])*)?(\+m)?)$/.exec(raw);
    if (!m) return null;
    const out = { c: 0, k: 0, d: 0, w: 0, minis: Boolean(m[2]) };
    const seen = new Set();
    let rawTotal = 0;
    let total = 0;
    if (m[1]) {
      for (const tok of m[1].split(',')) {
        const sp = tok[0];
        const cnt = Number(tok.slice(1));
        if (seen.has(sp) || !Number.isInteger(cnt) || cnt < 0 || cnt > 4) return null;
        seen.add(sp);
        rawTotal += cnt;
        const clamped = cnt > 0 ? 1 : 0;
        out[sp] = clamped;
        total += clamped;
      }
    }
    if (rawTotal > 6 || total > MASCOT_MAX_TOTAL) return null;
    return out;
  }

  function encodeMascotSpec(spec) {
    const src = spec && typeof spec === 'object' ? spec : {};
    const counts = { c: 0, k: 0, d: 0, w: 0 };
    let rem = MASCOT_MAX_TOTAL;
    for (const sp of MASCOT_SPECIES_ORDER) {
      const n = clamp(Number(src[sp]) > 0 ? 1 : 0, 0, min(MASCOT_MAX_PER_SPECIES, rem));
      counts[sp] = n;
      rem -= n;
    }
    const minis = Boolean(src.minis);
    const total = counts.c + counts.k + counts.d + counts.w;
    if (total === 0 && !minis) return 'off';
    if (counts.c === 1 && counts.k === 1 && counts.d === 0 && counts.w === 0) return minis ? 'minis' : 'crab';
    if (counts.c === 1 && counts.k === 1 && counts.d === 1 && counts.w === 1) return minis ? 'quad-minis' : 'quad';
    const parts = [];
    for (const sp of MASCOT_SPECIES_ORDER) {
      if (counts[sp] > 0) parts.push(sp + counts[sp]);
    }
    return 'r:' + parts.join(',') + (minis ? '+m' : '');
  }

  function normalizeMascotValue(raw, fallback = 'crab') {
    const parsed = parseMascotSpec(raw);
    return parsed ? encodeMascotSpec(parsed) : fallback;
  }

  function isValidMascotValue(raw) {
    return typeof raw === 'string' && parseMascotSpec(raw) !== null;
  }

  function mountDualMascotStage(hostEl, options = {}) {
    if (!hostEl) return null;
    const doc = hostEl.ownerDocument;
    const win = (doc?.defaultView) || (typeof window !== 'undefined' ? window : null);
    let hostSleep = false;
    let inspectState = null;
    let wb = false;
    const WB = 'data-ag-cs-win-blur';
    const PM = 'data-ag-prism-mode';
    const PP_OPEN = 'data-ag-pp-open';
    const isDocHidden = () => !!(doc?.hidden);
    const isPpOpen = () => {
      const root = doc?.documentElement;
      return Boolean(root && isFn(root.getAttribute) && root.getAttribute(PP_OPEN) === '1');
    };
    const isAttrB = () => {
      const root = doc?.documentElement;
      if (!root) return false;
      const val = isFn(root.getAttribute) ? root.getAttribute(WB) : null;
      if (val === '1') return true;
      if (val === '0') return false;
      return Boolean(isFn(root.hasAttribute) && root.hasAttribute(WB));
    };
    const isWindowBlurred = () => Boolean(isDocHidden() || isAttrB() || wb);
    const isHostSleeping = () => {
      if (hostSleep) return true;
      const root = doc?.documentElement;
      if (!root) return false;
      return isFn(root.getAttribute) && root.getAttribute(PM) === 'chat';
    };
    const readDpr = () => min((win?.devicePixelRatio) || 1, 2);
    let dpr = readDpr();
    const rand = (a, b) => a + random() * (b - a);
    const ticksIn = (minMs, maxMs) => max(1, round(rand(minMs, maxMs) / TICK));

    let tickIdx = 0;
    let disposed = false;
    let parked = false;
    let vramReclaimed = false;
    const isHostDetached = () => !!(hostEl?.isConnected === false);
    const isVramSleepState = () => Boolean(disposed || parked || isDocHidden() || isHostSleeping() || isHostDetached());
    const NO_TR_ATTRS = 'translate=no,data-no-translate=true,data-ag-localization-skip=true,data-agy-no-translate=true,data-antigravity-zh-skip=1,data-ag-no-i18n=,data-ag-owned=1'.split(',').map((s) => s.split('='));
    const markNoTrOwned = (el) => {
      if (el?.setAttribute) for (const [k, v] of NO_TR_ATTRS) el.setAttribute(k, v);
      return el;
    };

    // ── prefers-reduced-motion：无 window / matchMedia 时安全降级为 false ──
    let reducedMotion = false;
    let reducedMq = null;
    const onReducedChange = (e) => {
      reducedMotion = !!(e?.matches);
      if (reducedMotion) freezeMotion();
      else lastActivityAt = nowMs();
      syncHeartbeat();
    };
    try {
      if (win && isFn(win.matchMedia)) {
        reducedMq = win.matchMedia('(prefers-reduced-motion: reduce)');
        reducedMotion = !!(reducedMq?.matches);
        if (reducedMq && isFn(reducedMq.addEventListener)) {
          reducedMq.addEventListener('change', onReducedChange);
        } else if (reducedMq && isFn(reducedMq.addListener)) {
          reducedMq.addListener(onReducedChange);
        }
      }
    } catch {
      reducedMotion = false;
      reducedMq = null;
    }
    if (options.reducedMotion !== undefined) reducedMotion = !!options.reducedMotion;

    // 统一托管的延时器（剧目分镜 / 起跳预备），dispose 时全部清理
    const pendingTimers = new Set();
    const later = (ms, fn) => {
      const id = setTimeout(() => {
        pendingTimers.delete(id);
        if (!disposed) fn();
      }, ms);
      pendingTimers.add(id);
      return id;
    };

    const fillKeys = (o, keys, val) => { for (const k of keys.split(',')) o[k] = val; return o; };
    const createActorState = (id, kind, label, phaseTicks, phaseOff = 0) => {
      const a = {
        id, kind, label, pose: 'idle', phaseOff,
        nextBlinkTick: phaseTicks + ticksIn(2400, 6000),
        nextBreathTick: phaseTicks + ticksIn(2800, 4200),
        nextTwitchTick: phaseTicks + ticksIn(6000, 10000),
        nextSnapTick: phaseTicks + ticksIn(8000, 12000),
        nextGlanceAt: nowMs() + phaseTicks * TICK + rand(3000, 7000),
        walkStepTick: -1,
        lastRender: fillKeys({ cw: 0, ch: 0 }, 'poseKey,frameIdx,flip,tintState,tyPx,sqW,sqH,lastRot,clipBottomY', null),
      };
      fillKeys(a, 'x,y,vx,vy,rot,overrideUntil,overrideRot,clipStartTick,symUntil,flying,throws,lastThrowAt,pokeCount,lastPokeAt,nodY,nodUntil,eyeScan,seqStartTick,glanceDir,glanceUntil,balRot,passBoostUntil,lastDomRot', 0);
      fillKeys(a, 'sqx,sqy,patrolDir,twitchLen', 1);
      fillKeys(a, 'blinkTick,breathTick,twitchTick,snapTick,forceTwitchStart', -99);
      fillKeys(a, 'overridePose,sym,stackedOn,el,canvas,seq,seqThen,faceDir,clipParam,prevX,lastFx,lastSq,lastDomX,lastDomY,lastDomZ', null);
      fillKeys(a, 'dragging,ballisticActive,mirror,blinkDouble,glanceSecond', false);
      fillKeys(a, 'twitchSide,snapSide,forceTwitchSide', 'R');
      return a;
    };

    // 物种挂载顺序保持 k(cat) -> c(clawd) -> d(dragon) -> w(whale)，100% 兼容原有 ['cat','clawd'] / ['cat','clawd','dragon','whale'] 断言
    const SPECIES_DEF = [
      { key: 'k', kind: 'cat', label: 'Gemini Cat', basePhase: 14 },
      { key: 'c', kind: 'clawd', label: 'Claude Clawd', basePhase: 0 },
      { key: 'd', kind: 'dragon', label: 'GPT Dragon', basePhase: 23 },
      { key: 'w', kind: 'whale', label: 'DeepSeek Whale', basePhase: 31 },
    ];
    const buildRosterSpecs = (r) => {
      const specs = [];
      for (const sd of SPECIES_DEF) {
        if (!(Number(r[sd.key]) > 0)) continue;
        specs.push({
          id: sd.kind,
          kind: sd.kind,
          label: sd.label,
          phaseTicks: sd.basePhase,
          phaseOff: specs.length * 4 + (sd.key === 'k' ? 4 : sd.key === 'd' ? 7 : sd.key === 'w' ? 10 : 0),
        });
      }
      return specs;
    };
    const resolveInitialRoster = (opts) => {
      if (opts.mascot !== undefined) {
        const parsed = parseMascotSpec(opts.mascot);
        if (parsed) return parsed;
      }
      const q = !!opts.quadEnabled;
      return { c: 1, k: 1, d: q ? 1 : 0, w: q ? 1 : 0, minis: !!opts.miniPileEnabled };
    };
    let roster = resolveInitialRoster(options);
    let mascotSpec = encodeMascotSpec(roster);
    const actors = Object.create(null);
    let activeIds = [];
    for (const sp of buildRosterSpecs(roster)) {
      actors[sp.id] = createActorState(sp.id, sp.kind, sp.label, sp.phaseTicks, sp.phaseOff);
      activeIds.push(sp.id);
    }

    const miniCrabs = [
      { id: 'cowboy', x: 16, dir: 1 },
      { id: 'shades', x: 76, dir: -1 },
      { id: 'wizard', x: 136, dir: 1 },
    ];
    miniCrabs.forEach((mc, idx) => {
      mc.kind = 'mini';
      mc.blinkAt = -99;
      mc.nextBlink = ticksIn(1500, 6000);
      mc.lastX = mc.px = mc.x;
      mc.speed = [1.05, 0.86, 1.18][idx] || 1.0;
      fillKeys(mc, 'y,vx,vy,rot,balRot,flying,perchUntil,lastDomRot', 0);
      fillKeys(mc, 'bumpUntilTick,passHopUntilTick,cooldownTick', -1);
      fillKeys(mc, 'dragging,ballisticActive,mirror', false);
      fillKeys(mc, 'stackedOn,leap,act,lastDomX,lastDomY,lastDomZ,lastFrameKey', null);
    });

    const rAF =
      (win && isFn(win.requestAnimationFrame) && win.requestAnimationFrame.bind(win)) ||
      (typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame
        : (fn) => later(16, () => fn(nowMs())));

    const CHROMA_STORE_KEY = '__op_chroma_v1';
    const getStorage = () => {
      try {
        return options.storage || (win?.localStorage) || (typeof localStorage !== 'undefined' ? localStorage : null);
      } catch {
        return null;
      }
    };
    const readChromaSaved = () => {
      try {
        const st = getStorage();
        return Boolean(st?.getItem(CHROMA_STORE_KEY) === '1');
      } catch {
        return false;
      }
    };
    const writeChromaSaved = (on) => {
      try {
        const st = getStorage();
        if (!st) return;
        if (on) st.setItem(CHROMA_STORE_KEY, '1');
        else if (isFn(st.removeItem)) st.removeItem(CHROMA_STORE_KEY);
        else st.setItem(CHROMA_STORE_KEY, '0');
      } catch {
        /* 忽略存储受限环境 */
      }
    };

    const normalizeCamp = (c) => (c === 'claude' || c === 'gemini' || c === 'gpt' || c === 'deepseek' ? c : 'gemini');
    let camp = normalizeCamp(options.camp);
    let quadEnabled = roster.d > 0 || roster.w > 0;
    const activeMainIds = () => activeIds;
    const activeMainActors = () => activeIds.map((id) => actors[id]).filter(Boolean);
    const CAMP_TO_KIND = { claude: 'clawd', gemini: 'cat', gpt: 'dragon', deepseek: 'whale' };
    const campActors = (targetCamp = camp) => {
      const k = CAMP_TO_KIND[targetCamp] || 'cat';
      return activeMainActors().filter((a) => a.kind === k);
    };
    const workingActors = () => {
      const matched = campActors(camp);
      if (matched.length) return matched;
      const all = activeMainActors();
      return all.length ? [all[0]] : [];
    };
    const isWorkingActor = (a) => Boolean(a && workingActors().includes(a));
    const leaderActor = () => workingActors()[0] || null;
    const partnerActor = () => {
      const list = activeMainActors();
      if (!list.length) return null;
      const ws = workingActors();
      const nonWorker = list.find((a) => !ws.includes(a));
      if (nonWorker) return nonWorker;
      const lead = ws[0] || list[0];
      return list.find((a) => a !== lead) || lead;
    };
    let streaming = !!options.streaming;
    let streamTier = Number(options.streamTier || 2);
    let hasError = !!options.hasError;
    let yieldMode = options.yieldMode || 'none';
    let leapOffsetY = Number(options.leapOffsetY || 0);
    let popoverRightWidth = Number(options.popoverRightWidth || 0);
    let miniPileEnabled = !!roster.minis;
    let orchestrator = !!options.orchestrator;
    let prismaticCoat = readChromaSaved();
    const sharedSessionGates =
      !options.storage && hostEl && typeof hostEl === 'object'
        ? (hostEl.__opChromaGates || (hostEl.__opChromaGates = { tuned: false, forged: false }))
        : { tuned: false, forged: false };
    const chromaGates = sharedSessionGates;
    const chromaTapTimes = [];
    let chromaPhase = 0;
    const chromaSparks = [];
    let fxCanvasCleared = true;

    // 打盹生态：45s（深夜 30s）无用户操作 → 哈欠 → 打盹；任何操作唤醒
    const DOZE_AFTER_MS = 45000;
    const DOZE_AFTER_NIGHT_MS = 30000;
    let dozing = false;
    let lastActivityAt = nowMs();
    let lastHandoffAt = 0;
    let duetUntil = 0;
    let lastCrabStepTick = -1;
    const pairCooldowns = new Map();
    const canTriggerPair = (key, now, cdMs) => {
      const until = pairCooldowns.get(key) || 0;
      if (now < until) return false;
      pairCooldowns.set(key, now + cdMs);
      return true;
    };
    let lastInteraction = { type: null, pair: null, at: 0, tick: -1 };
    const recordInteraction = (type, pair, now = nowMs()) => {
      lastInteraction = { type, pair, at: now, tick: tickIdx };
    };
    let pauseTimer = 0;
    let theaterTimer = 0;
    let theaterCursor = 0;
    let tickTimer = null;
    let currentTickMs = 0;
    let lastMiniDisplay = null;
    const rim = { on: false, x: -9999, s: 0, t: 'default', d: true };
    let rimSig = '0';
    const perfStats = {
      canvasDraws: 0,
      canvasSkips: 0,
      domTransformWrites: 0,
      domTransformSkips: 0,
    };

    // 扩大至 96x84px (32x28 格, PX=3), OX=8, OY=17 -> y=10 脚底在 81px, 头顶留满 51px 放火舌/立麦/节点花!
    const CANVAS_W = 96;
    const CANVAS_H = 84;
    const OX = 8;
    const OY = 17;
    const PEEK_Y = 3;
    const MINI_PEEK_Y = 2;

    if (isFn(hostEl.removeChild)) {
      while (hostEl.firstChild) hostEl.removeChild(hostEl.firstChild);
    } else {
      hostEl.replaceChildren();
    }

    const miniGroupEl = markNoTrOwned(doc.createElement('div'));
    miniGroupEl.className = 'ag-v2-mini-pile';
    if (miniGroupEl.style) miniGroupEl.style.zIndex = 'auto';
    miniCrabs.forEach((mc) => {
      const cv = markNoTrOwned(doc.createElement('canvas'));
      cv.className = 'ag-v2-mini-crab-canvas';
      cv.width = round(40 * dpr);
      cv.height = round(32 * dpr);
      cv.dataset.miniCrab = mc.id;
      if (cv.style) Object.assign(cv.style, { pointerEvents: 'auto', cursor: 'grab', touchAction: 'none', transformOrigin: '20px 26px' });
      miniGroupEl.appendChild(cv);
      mc.canvas = cv;
      mc._ctx = isFn(cv.getContext) ? (cv._ctx = cv.getContext('2d')) : null;
      mc.el = cv;
    });
    hostEl.appendChild(miniGroupEl);

    const createActorDom = (actor, beforeNode = null) => {
      if (actor.el) return;
      const btn = markNoTrOwned(doc.createElement('div'));
      btn.className = 'ag-v2-mascot-actor';
      for (const [k, v] of [['data-mascot-id', actor.id], ['data-no-press-spring', '1'], ['role', 'button'], ['tabindex', '-1'], ['aria-label', actor.label]]) btn.setAttribute(k, v);
      const cv = markNoTrOwned(doc.createElement('canvas'));
      cv.className = 'ag-v2-mascot-canvas';
      cv.width = round(CANVAS_W * dpr);
      cv.height = round(CANVAS_H * dpr);
      if (cv.style) cv.style.transformOrigin = `${(OX + 8) * PX}px ${(OY + 10) * PX}px`;
      btn.appendChild(cv);
      actor.el = btn;
      actor.canvas = cv;
      actor._ctx = isFn(cv.getContext) ? (cv._ctx = cv.getContext('2d')) : null;
      if (beforeNode?.parentNode === hostEl && isFn(hostEl.insertBefore)) hostEl.insertBefore(btn, beforeNode);
      else hostEl.appendChild(btn);
    };

    for (const a of activeMainActors()) createActorDom(a);

    const fxCanvas = markNoTrOwned(doc.createElement('canvas'));
    fxCanvas.className = 'ag-v2-chroma-fx';
    const releaseFxCanvas = () => {
      fxCanvas.width = fxCanvas.height = 0;
      if (fxCanvas.style) { fxCanvas.style.width = fxCanvas.style.height = '0px'; fxCanvas.style.display = 'none'; }
      fxCanvasCleared = true;
    };
    if (fxCanvas.style) Object.assign(fxCanvas.style, { position: 'absolute', left: '0', bottom: '0', pointerEvents: 'none', zIndex: '42', imageRendering: 'pixelated' });
    releaseFxCanvas();
    hostEl.appendChild(fxCanvas);

    // ── 右侧角落微缩像素栖息地摆件（图层 z-index:14 在双宠背后，仅状态切换绘制 1 帧，日常 0fps）──
    const habitatCanvas = markNoTrOwned(doc.createElement('canvas'));
    habitatCanvas.className = 'ag-v2-habitat-prop';
    habitatCanvas.setAttribute('aria-hidden', 'true');
    if (habitatCanvas.style) Object.assign(habitatCanvas.style, { position: 'absolute', right: '10px', bottom: '2px', width: '24px', height: '30px', pointerEvents: 'none', zIndex: '14', imageRendering: 'pixelated' });
    hostEl.appendChild(habitatCanvas);
    let habitatPreview = 'auto';
    let scheduleWatchUntil = 0;
    let lastHabitatKey = '';
    const resolveHabitatMode = () => {
      if (habitatPreview !== 'auto') return habitatPreview;
      if (Date.now() < scheduleWatchUntil) return 'hourglass';
      const h = new Date().getHours();
      return h >= 23 || h < 5 ? 'lamp' : 'cactus';
    };
    const renderHabitatProp = (force = false) => {
      if (isVramSleepState()) return;
      const mode = resolveHabitatMode();
      const key = `${mode}:${dpr}`;
      if (!force && key === lastHabitatKey && habitatCanvas.width > 0 && habitatCanvas.height > 0) return;
      lastHabitatKey = key;
      const cssW = 24;
      const cssH = 30;
      habitatCanvas.width = round(cssW * dpr);
      habitatCanvas.height = round(cssH * dpr);
      const ctx = habitatCanvas._ctx || (habitatCanvas._ctx = habitatCanvas.getContext('2d'));
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);
      ctx.imageSmoothingEnabled = false;
      const propKey = mode === 'lamp' ? 'habLamp' : mode === 'hourglass' ? 'habHourglass' : 'habCactus';
      const spr = PROPS[propKey];
      if (!spr) return;
      const cell = 3;
      const hCells = spr.rows.length;
      const oy = max(0, floor(cssH / cell) - hCells);
      drawLayerSet(ctx, 0, oy, cell, PALETTES.clawd, [spr]);
      habitatCanvas.setAttribute('data-habitat-mode', mode);
    };
    renderHabitatProp(true);

    const zeroCv = (cv, drop) => {
      if (!cv) return;
      cv.width = cv.height = 0;
      if (drop) {
        cv._ctx = null;
        if (cv.__agRotOff) { zeroCv(cv.__agRotOff, 1); cv.__agRotOff = null; }
      }
    };
    const rmNode = (n) => {
      if (!n) return;
      if (isFn(n.remove)) n.remove();
      else if (n.parentNode?.removeChild) n.parentNode.removeChild(n);
      else if (hostEl?.removeChild) try { hostEl.removeChild(n); } catch {}
    };
    const resizeStageCvs = () => {
      for (const a of activeMainActors()) {
        if (a?.canvas) { a.canvas.width = round(CANVAS_W * dpr); a.canvas.height = round(CANVAS_H * dpr); }
        if (a?.lastRender) a.lastRender.poseKey = null;
      }
      for (const mc of miniCrabs) {
        if (mc.canvas) { mc.canvas.width = round(40 * dpr); mc.canvas.height = round(32 * dpr); }
        mc.lastFrameKey = null;
      }
    };

    // ── A1 VRAM 0x0 回收与唤醒恢复（document.hidden / park / hostSleep / detached） ──
    const reclaimStageVram = () => {
      if (vramReclaimed) return;
      vramReclaimed = true;
      releaseFxCanvas();
      if (habitatCanvas) { zeroCv(habitatCanvas); lastHabitatKey = ''; }
      for (const a of activeMainActors()) {
        zeroCv(a?.canvas);
        if (a?.lastRender) { a.lastRender.poseKey = null; a.lastRender.cw = a.lastRender.ch = 0; }
      }
      for (const mc of miniCrabs) { zeroCv(mc.canvas); mc.lastFrameKey = null; }
    };

    const restoreStageVram = () => {
      const mains = activeMainActors();
      const mainsOk = mains.every((a) => a.canvas && a.canvas.width > 0);
      const minisOk = !miniPileEnabled || miniCrabs.every((mc) => mc.canvas && mc.canvas.width > 0);
      if (!vramReclaimed && mainsOk && minisOk) return false;
      dpr = readDpr();
      vramReclaimed = false;
      resizeStageCvs();
      lastHabitatKey = '';
      return true;
    };

    // ── 多宠统一图腾塔拓扑、抽底重力补位与地面刚体防重叠核心 ─────────────────
    const miniById = new Map(miniCrabs.map((m) => [m.id, m]));
    const getEnt = (id) => (hasOwn(actors, id) ? actors[id] : miniById.get(id) || null);
    const isMiniEnt = (ent) => Boolean(ent?.kind === 'mini');
    const entHalfW = (ent) => (isMiniEnt(ent) ? 13 : 22);
    const mountStepH = (holderId) => (hasOwn(actors, holderId) ? 26 : 16);
    const allActiveEnts = () => (miniPileEnabled ? [...activeMainActors(), ...miniCrabs] : activeMainActors());
    const maxTowerDepthAllowed = () => activeMainActors().length + (miniPileEnabled ? miniCrabs.length : 0);

    const syncStageDpr = () => {
      const nextDpr = readDpr();
      if (nextDpr === dpr) return false;
      dpr = nextDpr;
      resizeStageCvs();
      return true;
    };

    const cleanups = [];
    const MASCOT_DRAG_ATTR = 'data-ag-cs-mascot-drag';
    const RESIZE_ATTR = 'data-ag-cs-resizing';
    let rootMascotDragAttr = false;
    const syncMascotDragRootAttr = () => {
      const anyDragging =
        !disposed &&
        (activeMainActors().some((a) => !!a.dragging) ||
          miniCrabs.some((mc) => !!mc.dragging));
      if (rootMascotDragAttr === anyDragging) return;
      rootMascotDragAttr = anyDragging;
      const htmlEl = doc?.documentElement;
      if (!htmlEl) return;
      try {
        if (anyDragging) htmlEl.setAttribute?.(MASCOT_DRAG_ATTR, '1');
        else htmlEl.removeAttribute?.(MASCOT_DRAG_ATTR);
      } catch {}
    };
    const initHostW = hostEl.clientWidth;
    let hasMeasuredHostWidth = typeof initHostW === 'number' && initHostW > 0;
    let cachedHostWidth = hasMeasuredHostWidth ? initHostW : 0;
    const isMockHostWidth = hasOwn(hostEl, 'clientWidth');
    let pdOn = false, reboundTm = null, resizeRaf = 0, pendPrevW = 0, pendNextW = 0;
    const isStageResizing = () =>
      Boolean(pdOn || (doc?.documentElement && doc.documentElement.getAttribute?.(RESIZE_ATTR) === '1'));
    const snapRot = (deg) => {
      const v = Number(deg) || 0;
      return abs(v) < 0.05 ? 0 : round(v * 100) / 100;
    };
    const applyMiniTransform = (mc, tx, ty, tz, rot = 0) => {
      const dom = mc.canvas || mc.el;
      if (!dom || !dom.style) return;
      const nextRot = snapRot(rot);
      if (mc.lastDomX !== tx || mc.lastDomY !== ty || mc.lastDomRot !== nextRot) {
        mc.lastDomX = tx;
        mc.lastDomY = ty;
        mc.lastDomRot = nextRot;
        dom.style.transform = nextRot
          ? `translate3d(${tx}px, ${ty}px, 0) rotate(${nextRot}deg)`
          : `translate3d(${tx}px, ${ty}px, 0)`;
        perfStats.domTransformWrites += 1;
      } else {
        perfStats.domTransformSkips += 1;
      }
      if (tz != null && mc.lastDomZ !== tz) {
        mc.lastDomZ = tz;
        dom.style.zIndex = tz;
      }
    };
    if (win && isFn(win.addEventListener)) {
      const onPd = () => { pdOn = true; }, onPu = () => { pdOn = false; }, pOpt = { capture: true, passive: true };
      win.addEventListener('pointerdown', onPd, pOpt);
      win.addEventListener('pointerup', onPu, pOpt);
      win.addEventListener('pointercancel', onPu, pOpt);
      win.addEventListener('blur', onPu);
      cleanups.push(() => {
        if (reboundTm) { clearTimeout(reboundTm); pendingTimers.delete(reboundTm); reboundTm = null; }
        if (resizeRaf) { try { win.cancelAnimationFrame?.(resizeRaf); } catch {} resizeRaf = 0; }
        win.removeEventListener('pointerdown', onPd, pOpt);
        win.removeEventListener('pointerup', onPu, pOpt);
        win.removeEventListener('pointercancel', onPu, pOpt);
        win.removeEventListener('blur', onPu);
      });
    }
    const maxXFor = (w) => max(8, max(96, w - 14 - (popoverRightWidth > 0 ? min(w - 150, popoverRightWidth + 16) : 0)) - 80);
    const miniZ = (m) => (yieldMode === 'peek' ? '8' : m.dragging ? '39' : m.stackedOn ? String(25 + getStackDepth(m.id) * 2) : '25');
    const syncTower = (a, now = nowMs()) => {
      if (isMiniEnt(a)) {
        const dom = a.canvas || a.el;
        if (dom) {
          const direct = syncDirectMotionDomAttr(a, dom);
          const tx = snapCoord(isFin(a.px) ? a.px : a.x, direct);
          const ty = snapCoord((a.y || 0) + (yieldMode === 'peek' && !a.dragging ? MINI_PEEK_Y : 0), direct);
          applyMiniTransform(a, tx, ty, miniZ(a), a.dragging || a.ballisticActive ? a.rot : 0);
        }
      } else {
        applyActorTransform(a, now);
      }
      for (const cid of getTowerMembers(a.id)) {
        if (cid === a.id) continue;
        const r = getEnt(cid);
        if (!r) continue;
        if (isMiniEnt(r)) {
          const dom = r.canvas || r.el;
          if (!dom) continue;
          const direct = syncDirectMotionDomAttr(r, dom);
          const tx = snapCoord(getEntWorldCx(a) - 32, direct);
          const ty = snapCoord(computeWorldFootY(r) + (yieldMode === 'peek' && !r.dragging ? PEEK_Y : 0), direct);
          r.px = tx;
          r.lastX = round(tx);
          applyMiniTransform(r, tx, ty, miniZ(r), 0);
        } else {
          applyActorTransform(r, now);
        }
      }
    };
    const freeMain = (a) => !!(a?.el && !a.dragging && !a.stackedOn);
    const applyReboundGlide = (a) => {
      if (reducedMotion) return;
      const now = nowMs();
      for (const cid of getTowerMembers(a.id)) {
        const ent = getEnt(cid);
        if (ent?.el?.style) {
          const seq = (ent.glideSeq = (ent.glideSeq || 0) + 1);
          ent.glideUntil = now + 320;
          ent.el.style.transition = 'transform 320ms cubic-bezier(.22,1,.36,1)';
          later(340, () => {
            if (!disposed && ent.glideSeq === seq && ent.el?.style && !ent.lastDomDirect && ent.el.style.transition.includes('320ms')) {
              ent.el.style.transition = '';
              ent.glideUntil = 0;
            }
          });
        }
      }
    };
    const launchRebound = (a, targetCapX) => {
      if (disposed || !freeMain(a) || !a.sideEdgeSnap || a.sidePushOriginX == null) return;
      const ox = a.sidePushOriginX;
      const fm = maxXFor(max(readStageWidth(), cachedHostWidth));
      const tx = max(8, min(ox, targetCapX, fm));
      const dist = tx - a.x;
      a.sideEdgeSnap = false; a.sidePushOriginX = null; a.sideEdgeOffset = 0; a.sideEdgeDirectUntil = 0;
      if (dist >= 28 && !reducedMotion && !findDirectRider(a.id)) {
        const vy0 = -clamp(4.4 + dist / 220, 4.6, 8.2);
        let svy = vy0, sy = 0, sb = 0, sGain = 0, sMul = 1;
        for (let t = 0; t < 160; t++) {
          svy += 0.44;
          sMul *= 0.988;
          svy *= 0.988;
          sy += svy;
          sGain += sMul;
          if (sy >= 0) {
            sy = 0;
            if (abs(svy) > 2.4 && sb < 2) {
              svy = -svy * 0.36;
              sMul *= 0.82;
              sb += 1;
            } else break;
          }
        }
        const vx0 = dist / max(1, sGain);
        startBallistic(a, vx0, vy0, { noSnap: true, reboundTargetX: tx, reboundNoBump: true });
        renderAllFrames();
      } else if (tx > a.x + 1) {
        a.x = tx;
        syncTower(a);
        applyReboundGlide(a);
      } else {
        syncTower(a);
      }
    };
    const scheduleRebound = () => {
      if (reboundTm) { clearTimeout(reboundTm); pendingTimers.delete(reboundTm); reboundTm = null; }
      reboundTm = later(120, () => {
        reboundTm = null;
        if (isStageResizing()) return;
        const fm = maxXFor(max(readStageWidth(), cachedHostWidth));
        const mains = activeMainActors();
        const list = mains
          .filter((a) => freeMain(a) && a.sideEdgeSnap && a.sidePushOriginX != null)
          .sort((u, v) => v.sidePushOriginX - u.sidePushOriginX);
        let capX = fm;
        const targets = list.map((a) => {
          const tx = clamp(capX, 8, a.sidePushOriginX);
          capX = max(8, tx - 56);
          return { a, tx };
        });
        targets.forEach(({ a, tx }, idx) => (idx ? later(55 * idx, () => launchRebound(a, tx)) : launchRebound(a, tx)));
      });
    };
    const onStageResizeReleased = () => {
      if (disposed || isStageResizing()) return;
      const mains = activeMainActors();
      const snapped = mains
        .filter((a) => freeMain(a) && a.sideEdgeSnap && a.sidePushOriginX != null)
        .sort((u, v) => v.sidePushOriginX - u.sidePushOriginX);
      if (!snapped.length) return;
      let capX = maxXFor(max(readStageWidth(), cachedHostWidth));
      let needReb = false;
      for (const a of snapped) {
        const tx = clamp(capX, 8, a.sidePushOriginX);
        capX = max(8, tx - 56);
        if (tx > a.x + 2) needReb = true;
      }
      if (needReb) {
        scheduleRebound();
      } else {
        for (const a of snapped) {
          a.sideEdgeDirectUntil = 0;
          syncDirectMotionDomAttr(a, a.el);
        }
      }
    };
    const handleStageWidthResize = (prevW, nw) => {
      if (disposed || !isFin(nw) || nw <= 0 || nw === prevW) return;
      const now = nowMs(), nextMaxX = maxXFor(nw), mains = activeMainActors(), resizingNow = isStageResizing();
      if (nw < prevW) {
        if (reboundTm) { clearTimeout(reboundTm); pendingTimers.delete(reboundTm); reboundTm = null; }
        // 快路径：主角均远离右边界时 0 计算早退
        if (!mains.some((a) => freeMain(a) && a.x >= nextMaxX - 96)) return;
        const beforeX = mains.map((a) => (a ? a.x : 0));
        const order = mains.map((_, idx) => idx).sort((i, j) => beforeX[j] - beforeX[i]);
        let capX = nextMaxX;
        for (const i of order) {
          const a = mains[i];
          if (!freeMain(a)) continue;
          if (a.x > capX) { a.x = capX; capX = max(8, capX - 1); }
          else capX = clamp(a.x - 1, 8, capX);
        }
        enforceGroundSeparation();
        for (let i = 0; i < mains.length; i++) {
          const a = mains[i];
          if (!freeMain(a)) continue;
          if (a.x < beforeX[i] - 0.5 || a.x >= nextMaxX - 4) {
            if (a.sidePushOriginX == null) a.sidePushOriginX = beforeX[i];
            a.sideEdgeSnap = true;
            a.sideEdgeOffset = max(0, nextMaxX - a.x);
            a.sideEdgeDirectUntil = now + (resizingNow ? 220 : 180);
            syncTower(a, now);
          }
        }
        return;
      }
      if (!mains.some((a) => freeMain(a) && a.sideEdgeSnap && a.sidePushOriginX != null)) return;
      let needReb = false;
      const prevMaxX = maxXFor(prevW);
      for (const a of mains) {
        if (!freeMain(a) || !a.sideEdgeSnap || a.sidePushOriginX == null) continue;
        const off = a.sideEdgeOffset || 0;
        if (!reboundTm && a.x < prevMaxX - off - 64) { a.sideEdgeSnap = false; a.sidePushOriginX = null; continue; }
        const tx = clamp(nextMaxX - off, 8, a.sidePushOriginX);
        if (resizingNow) {
          if (reboundTm) { clearTimeout(reboundTm); pendingTimers.delete(reboundTm); reboundTm = null; }
          a.sideEdgeDirectUntil = now + 220;
          a.x = tx;
          syncTower(a, now);
          if (tx >= a.sidePushOriginX - 1) { a.sideEdgeSnap = false; a.sidePushOriginX = null; a.sideEdgeOffset = 0; }
        } else {
          needReb = true;
        }
      }
      if (needReb) {
        scheduleRebound();
      }
    };
    const schedStageResize = (prevW, nw) => {
      if (!pendPrevW) pendPrevW = prevW;
      pendNextW = nw;
      if (resizeRaf) return;
      const flush = () => {
        if (disposed) return;
        resizeRaf = 0;
        const p = pendPrevW, n = pendNextW;
        pendPrevW = pendNextW = 0;
        handleStageWidthResize(p, n);
      };
      if (win && isFn(win.requestAnimationFrame)) resizeRaf = win.requestAnimationFrame(flush);
      else flush();
    };
    if (!isMockHostWidth && typeof ResizeObserver === 'function' && hostEl?.nodeType === 1) {
      try {
        const hostRo = new ResizeObserver((entries) => {
          if (disposed) return;
          const lastEntry = entries?.length ? entries[entries.length - 1] : null;
          const cr = lastEntry?.contentRect;
          // 仅读取 contentRect.width，杜绝折叠/空帧回退读 hostEl.clientWidth 触发同步回流
          const nw = cr && typeof cr.width === 'number' ? round(cr.width) : 0;
          const dprChanged = syncStageDpr();
          if (nw > 0) {
            const prevW = cachedHostWidth || 720;
            hasMeasuredHostWidth = true;
            cachedHostWidth = nw;
            if (nw !== prevW) schedStageResize(prevW, nw);
          }
          if (dprChanged) renderAllFrames();
        });
        hostRo.observe(hostEl);
        cleanups.push(() => hostRo.disconnect());
      } catch {}
    }
    const readStageWidth = () => {
      if (isMockHostWidth) return hostEl.clientWidth || 720;
      if (!hasMeasuredHostWidth) {
        const w = hostEl.clientWidth;
        if (typeof w === 'number' && w > 0) {
          cachedHostWidth = w;
          hasMeasuredHostWidth = true;
        }
      }
      return cachedHostWidth || 720;
    };

    const stageBoundsX = () => {
      const w = readStageWidth();
      const rightReserve = popoverRightWidth > 0 ? min(w - 150, popoverRightWidth + 16) : 0;
      return {
        minX: 14,
        maxX: max(96, w - 14 - rightReserve),
      };
    };

    const clampActorX = (x) => {
      const w = readStageWidth();
      const rightReserve = popoverRightWidth > 0 ? min(w - 150, popoverRightWidth + 16) : 0;
      const maxX = max(24, w - 88 - rightReserve);
      return clamp(x, 8, maxX);
    };

    const getEntWorldCx = (ent) => (isMiniEnt(ent) ? 12 + (isFin(ent.px) ? ent.px : ent.x) + 20 : ent.x + 48);
    const setEntWorldCx = (ent, cx) => {
      const { minX, maxX } = stageBoundsX();
      const hw = entHalfW(ent);
      const clamped = clamp(cx, minX + hw, maxX - hw);
      if (isMiniEnt(ent)) {
        const px = max(2, clamped - 32);
        ent.px = px;
        ent.lastX = round(px);
      } else {
        ent.x = clampActorX(clamped - 48);
      }
    };

    const findDirectRider = (holderId) => {
      for (const e of [...activeMainActors(), ...miniCrabs]) {
        if (e.stackedOn === holderId) return e;
      }
      return null;
    };

    const getStackDepth = (id) => {
      let d = 0;
      let cur = getEnt(id);
      const seen = new Set();
      while (cur?.stackedOn && !seen.has(cur.id)) {
        seen.add(cur.id);
        const base = getEnt(cur.stackedOn);
        if (!base) break;
        d += 1;
        cur = base;
      }
      return d;
    };

    const getTowerRoot = (id) => {
      let cur = getEnt(id);
      const seen = new Set();
      while (cur?.stackedOn && !seen.has(cur.id)) {
        seen.add(cur.id);
        const base = getEnt(cur.stackedOn);
        if (!base) break;
        cur = base;
      }
      return cur;
    };

    const getTowerMembers = (anyId) => {
      const root = getTowerRoot(anyId);
      if (!root) return [];
      const chain = [root.id];
      const seen = new Set(chain);
      let curId = root.id;
      while (true) {
        const next = findDirectRider(curId);
        if (!next || seen.has(next.id)) break;
        seen.add(next.id);
        chain.push(next.id);
        curId = next.id;
      }
      return chain;
    };

    const getStackTop = (anyId) => {
      const chain = getTowerMembers(anyId);
      return chain.length ? getEnt(chain[chain.length - 1]) : getEnt(anyId);
    };

    const listAllTowers = () => {
      const out = [];
      const visited = new Set();
      for (const e of allActiveEnts()) {
        if (visited.has(e.id)) continue;
        const chain = getTowerMembers(e.id);
        chain.forEach((cid) => visited.add(cid));
        if (chain.length >= 2) out.push(chain);
      }
      return out;
    };

    const computeWorldFootY = (ent) => {
      if (!ent) return 0;
      if (ent.stackedOn) {
        const seen = new Set([ent.id]);
        let cur = ent;
        let yAcc = 0;
        while (cur?.stackedOn && !seen.has(cur.stackedOn)) {
          seen.add(cur.stackedOn);
          const base = getEnt(cur.stackedOn);
          if (!base) break;
          yAcc -= mountStepH(base.id);
          cur = base;
        }
        return (cur ? cur.y || 0 : 0) + yAcc;
      }
      return ent.y || 0;
    };

    const syncAllStackedFollowers = () => {
      for (const root of allActiveEnts()) {
        if (root.stackedOn) continue;
        const chain = getTowerMembers(root.id);
        if (chain.length < 2) continue;
        const rootCx = getEntWorldCx(root);
        let yCursor = root.y || 0;
        for (let i = 1; i < chain.length; i++) {
          const prev = getEnt(chain[i - 1]);
          const rider = getEnt(chain[i]);
          if (!rider || rider.dragging) break;
          yCursor -= mountStepH(prev.id);
          setEntWorldCx(rider, rootCx);
          rider.y = yCursor;
        }
      }
    };

    const enforceGroundSeparation = (lockedId = null) => {
      const { minX, maxX } = stageBoundsX();
      const groundList = [];
      for (const e of allActiveEnts()) {
        if (e.stackedOn || e.dragging || e.ballisticActive) continue;
        if ((e.y || 0) < -3 || e.leap) continue;
        if (isMiniEnt(e) && e.act && (e.act.type === 'ride' || e.act.type === 'leap')) continue;
        groundList.push({
          id: e.id,
          ent: e,
          cx: getEntWorldCx(e),
          halfW: entHalfW(e),
          locked: e.id === lockedId,
        });
      }
      if (groundList.length >= 2) {
        resolveGroundSeparation(groundList, minX, maxX, 6);
        for (const item of groundList) {
          if (!item.locked) setEntWorldCx(item.ent, item.cx);
        }
      }
      syncAllStackedFollowers();
    };

    const spawnChromaBurst = (cx, cy, count = 12, gentle = false) => {
      for (let i = 0; i < count; i++) {
        if (chromaSparks.length >= 48) chromaSparks.shift();
        const ang = gentle
          ? -PI * (0.25 + random() * 0.5)
          : (i / max(1, count)) * PI * 2 + (random() - 0.5) * 0.18;
        const spd = gentle ? 0.6 + random() * 0.9 : 2.2 + (i % 2) * 1.15 + random() * 0.6;
        chromaSparks.push({
          x: cx + (gentle ? (random() - 0.5) * 14 : 0),
          y: cy + (gentle ? -4 - random() * 8 : 0),
          vx: cos(ang) * spd,
          vy: sin(ang) * spd - (gentle ? 0.8 : 1.1),
          life: 0,
          maxLife: gentle ? 6 : 11,
          color: CHROMA_HEX[i % CHROMA_HEX.length],
          size: gentle ? 3 : i % 3 === 0 ? 4 : 3,
        });
      }
    };

    const getRestPositions = () => {
      const mains = activeMainActors();
      const n = mains.length;
      if (n === 0) return {};
      const w = readStageWidth();
      const safeRight = popoverRightWidth > 0 ? max(185, w - popoverRightWidth - 18) : w - 12;
      const leaderX = clampActorX(safeRight - 82);
      if (n === 1) return { [mains[0].id]: leaderX };
      if (n === 2 && roster.c === 1 && roster.k === 1 && !roster.d && !roster.w) {
        const partnerX = clampActorX(leaderX - 66);
        return camp === 'claude' ? { clawd: leaderX, cat: partnerX } : { cat: leaderX, clawd: partnerX };
      }
      const lead = leaderActor() || mains[0];
      const step = min(62, max(34, floor((leaderX - 16) / max(1, n - 1))));
      const restOrder = mains.filter((a) => a !== lead);
      const pos = { [lead.id]: leaderX };
      restOrder.forEach((a, idx) => {
        pos[a.id] = clampActorX(leaderX - step * (idx + 1));
      });
      return pos;
    };

    const resetHomePositions = (animateWalk = false) => {
      const pos = getRestPositions();
      for (const id of activeMainIds()) {
        const a = actors[id];
        if (a.dragging || a.stackedOn) continue;
        a.sideEdgeSnap = false;
        a.sidePushOriginX = null;
        a.sideEdgeOffset = 0;
        a.sideEdgeDirectUntil = 0;
        const target = pos[id];
        if (animateWalk && !reducedMotion && abs(a.x - target) > 6 && a.y === 0) {
          a.overridePose = 'walk';
          a.overrideUntil = nowMs() + 380;
          a.overrideRot = 0;
        }
        a.x = target;
        if (a.y > 0) a.y = 0;
      }
      enforceGroundSeparation();
    };

    resetHomePositions(false);

    // ── 节拍序列：steps = [pose, ticks, sqW, sqH, lift] ───────────────────────
    const playSeq = (actor, steps, then) => {
      actor.seq = steps.map(([pose, ticks, sqW = 0, sqH = 0, lift = 0]) => ({ pose, ticks, sqW, sqH, lift }));
      actor.seqStartTick = tickIdx + 1;
      actor.seqThen = then || null;
    };
    const seqStep = (actor) => {
      if (!actor.seq) return null;
      let k = max(0, tickIdx - actor.seqStartTick);
      for (const st of actor.seq) {
        if (k < st.ticks) return st;
        k -= st.ticks;
      }
      actor.seq = null;
      const then = actor.seqThen;
      actor.seqThen = null;
      if (then) then();
      return null;
    };
    const seqTotalMs = (steps) => steps.reduce((s, st) => s + st[1] * TICK, 0) + TICK;

    const landingSteps = (flatTicks) => [
      ['flat', flatTicks, 2, 0],
      ['idle', 1, -2, 1],
      ['idle', 1, 2, -1],
    ];

    const hopSteps = (airPose) => [
      ['squash', 1, 2, -1, 0],
      [airPose, 1, -1, 1, -2],
      [airPose, 1, 0, 0, -4],
      [airPose, 1, 0, 0, -4],
      [airPose, 1, 0, 0, -2],
      ['idle', 1, 2, -1, 0],
    ];

    const resolvePoseFor = (actor, now) => {
      if (actor.dragging) return 'dangle';
      const st = seqStep(actor);
      if (st) return st.pose;
      if (actor.overridePose && now < actor.overrideUntil) return actor.overridePose;
      if (actor.overridePose && now >= actor.overrideUntil) {
        actor.overridePose = null;
        actor.overrideRot = 0;
        actor.mirror = false;
        actor.faceDir = null;
        actor.clipParam = null;
      }
      if (yieldMode === 'peek') return 'peek';
      const isWorker = isWorkingActor(actor);
      if (hasError && isWorker) return 'angry';
      if (streaming) {
        return isWorker ? 'write' : actor.kind === 'cat' || actor.kind === 'whale' ? 'loaf' : 'sleep';
      }
      if (dozing) return 'sleep';
      if (!isWorker && (actor.kind === 'cat' || actor.kind === 'whale') && floor(now / 9000) % 2 === 1) return 'loaf';
      return actor.pose || 'idle';
    };

    const effectiveRot = (a, now) => {
      if (a.stackedOn && a.balRot && !a.dragging) return a.balRot;
      return now < a.overrideUntil && a.overrideRot ? a.overrideRot : a.rot;
    };

    const isEntDirectMotion = (ent) => {
      if (!ent) return false;
      const now = nowMs();
      const resizingNow = isStageResizing();
      if (
        ent.dragging ||
        ent.ballisticActive ||
        ent.leap ||
        (ent.sideEdgeSnap && resizingNow) ||
        (ent.sideEdgeDirectUntil > 0 && now < ent.sideEdgeDirectUntil) ||
        (!ent.stackedOn && (ent.y || 0) < -0.4)
      ) {
        return true;
      }
      if (ent.stackedOn) {
        const root = getTowerRoot(ent.id);
        if (
          root &&
          root !== ent &&
          (root.dragging ||
            root.ballisticActive ||
            root.leap ||
            (root.sideEdgeSnap && resizingNow) ||
            (root.sideEdgeDirectUntil > 0 && now < root.sideEdgeDirectUntil) ||
            (root.y || 0) < -0.4)
        ) {
          return true;
        }
      }
      return false;
    };

    const syncDirectMotionDomAttr = (ent, domEl) => {
      if (!domEl || !domEl.style) return false;
      const direct = isEntDirectMotion(ent);
      const dragNow = !!(ent?.dragging);
      if (ent.lastDomDirect !== direct) {
        ent.lastDomDirect = direct;
        if (direct) {
          domEl.setAttribute?.('data-direct', '1');
          domEl.style.transition = 'none';
        } else {
          domEl.removeAttribute?.('data-direct');
          domEl.style.transition = '';
        }
      }
      if (ent.lastDomDrag !== dragNow) {
        ent.lastDomDrag = dragNow;
        if (dragNow) {
          domEl.setAttribute?.('data-dragging', '1');
          domEl.style.cursor = 'grabbing';
        } else {
          domEl.removeAttribute?.('data-dragging');
          domEl.style.cursor = 'grab';
        }
      }
      syncMascotDragRootAttr();
      return direct;
    };

    const snapCoord = (v, direct) => (direct ? round(v * 100) / 100 : round(v));

    const applyActorTransform = (actor, now = nowMs()) => {
      if (!actor.el) return;
      let yPx = actor.y;
      if (actor.stackedOn) {
        const root = getTowerRoot(actor.id);
        const worldCx = getEntWorldCx(root || actor);
        actor.x = clampActorX(worldCx - 48);
        yPx = computeWorldFootY(actor) + (yieldMode === 'leap' ? -leapOffsetY : yieldMode === 'peek' && !actor.dragging ? PEEK_Y : 0);
      } else if (yieldMode === 'leap' && !actor.dragging && actor.y === 0) {
        yPx -= leapOffsetY;
      } else if (yieldMode === 'peek' && !actor.dragging) {
        yPx += PEEK_Y;
      }
      const direct = syncDirectMotionDomAttr(actor, actor.el);
      const depth = actor.stackedOn ? getStackDepth(actor.id) : 0;
      const tx = snapCoord(actor.x, direct);
      const ty = snapCoord(yPx, direct);
      const tz = yieldMode === 'peek' ? '8' : actor.dragging ? '38' : depth > 0 ? String(24 + depth * 2) : '24';
      if (actor.lastDomX !== tx || actor.lastDomY !== ty) {
        actor.lastDomX = tx;
        actor.lastDomY = ty;
        actor.el.style.transform = `translate3d(${tx}px, ${ty}px, 0)`;
        perfStats.domTransformWrites += 1;
      } else {
        perfStats.domTransformSkips += 1;
      }
      // 60fps GPU 倾角同步到内层 canvas（外层 actor.el 维持纯 translate3d 兼容），静止 rot=0 清回 ''
      const nextRot = snapRot(inspectState ? 0 : effectiveRot(actor, now));
      if (actor.lastDomRot !== nextRot) {
        actor.lastDomRot = nextRot;
        actor.lastRender.lastRot = nextRot;
        if (actor.canvas && actor.canvas.style) {
          actor.canvas.style.transform = nextRot ? `rotate(${nextRot}deg)` : '';
        }
        perfStats.domTransformWrites += 1;
      }
      if (actor.lastDomZ !== tz) {
        actor.lastDomZ = tz;
        actor.el.style.zIndex = tz;
      }
    };

    // ── 待机微动作：随机眨眼 / 呼吸下沉 / 耳尖抖动 / 单钳开合 / 左顾右盼 ──
    const updateIdleFx = (a, pose, now) => {
      // 眨眼计时在任何姿态下推进，仅在可眨眼姿态生效；减少动态时依旧保留
      if (tickIdx >= a.nextBlinkTick) {
        a.blinkTick = tickIdx;
        a.blinkDouble = random() < 0.15;
        a.nextBlinkTick = tickIdx + ticksIn(2400, 6000) + (a.blinkDouble ? 5 : 3);
      }
      const bk = tickIdx - a.blinkTick;
      const blinkSeq = a.blinkDouble ? BLINK_DOUBLE : BLINK_SINGLE;
      const fx = {
        blinkStage: bk >= 0 && bk < blinkSeq.length ? blinkSeq[bk] : null,
        breath: false,
        earTwitch: null,
        clawSnap: null,
        glance: 0,
      };
      const idleNow = pose === 'idle' && !a.seq && !a.dragging;
      if (reducedMotion || !idleNow) {
        // 非待机期间把到期的微动作顺延，避免回到待机瞬间扎堆触发
        if (tickIdx >= a.nextBreathTick) a.nextBreathTick = tickIdx + ticksIn(800, 1800);
        if (tickIdx >= a.nextTwitchTick) a.nextTwitchTick = tickIdx + ticksIn(1500, 4000);
        if (tickIdx >= a.nextSnapTick) a.nextSnapTick = tickIdx + ticksIn(1500, 4000);
        a.glanceDir = 0;
        if (now >= a.nextGlanceAt) a.nextGlanceAt = now + rand(1500, 4000);
        return fx;
      }
      // 呼吸：每 2.8~4.2s 下沉 1 格持续 2 拍
      if (tickIdx >= a.nextBreathTick) {
        a.breathTick = tickIdx;
        a.nextBreathTick = tickIdx + ticksIn(2800, 4200);
      }
      const brk = tickIdx - a.breathTick;
      fx.breath = brk >= 0 && brk < 2;
      if (a.kind === 'cat' || a.kind === 'dragon' || a.kind === 'whale') {
        // 耳尖抖动 / 龙角闪光 / 鲸尾拍浪：6~10s 一次，1~2 拍
        if (tickIdx >= a.nextTwitchTick) {
          a.twitchTick = tickIdx;
          a.twitchLen = random() < 0.5 ? 1 : 2;
          a.twitchSide = random() < 0.5 ? 'L' : 'R';
          a.nextTwitchTick = tickIdx + ticksIn(6000, 10000);
        }
        const tk = tickIdx - a.twitchTick;
        if (tk >= 0 && tk < a.twitchLen) fx.earTwitch = a.twitchSide;
      }
      if (a.kind === 'clawd' || a.kind === 'dragon' || a.kind === 'whale') {
        // 单钳开合 / 龙翼微振 / 鲸鳍轻摆：8~12s 一次，开-合-开-合 共 4 拍
        if (tickIdx >= a.nextSnapTick) {
          a.snapTick = tickIdx;
          a.snapSide = random() < 0.5 ? 'L' : 'R';
          a.nextSnapTick = tickIdx + ticksIn(8000, 12000);
        }
        const sk = tickIdx - a.snapTick;
        if (sk >= 0 && sk < 4 && sk % 2 === 0) fx.clawSnap = a.snapSide;
      }
      // 左顾右盼：随机方向 + 随机驻留，30% 概率回看另一侧
      if (!a.glanceDir && now >= a.nextGlanceAt) {
        a.glanceDir = random() < 0.5 ? -1 : 1;
        a.glanceUntil = now + rand(600, 1800);
        a.glanceSecond = random() < 0.3;
      }
      if (a.glanceDir && now >= a.glanceUntil) {
        if (a.glanceSecond) {
          a.glanceDir = -a.glanceDir;
          a.glanceUntil = now + rand(500, 1400);
          a.glanceSecond = false;
        } else {
          a.glanceDir = 0;
          a.nextGlanceAt = now + rand(4000, 9000);
        }
      }
      fx.glance = a.glanceDir;
      return fx;
    };

    // ── 叠叠乐平衡：下方角色（含迷你蟹）每拍位移 → 上方角色反向摆角（±8°）──
    const updateBalance = () => {
      for (const id of activeMainIds()) {
        const top = actors[id];
        const base = top.stackedOn ? getEnt(top.stackedOn) : null;
        let target = 0;
        if (base && !reducedMotion && base.prevCx != null) {
          target = max(-8, min(8, -(getEntWorldCx(base) - base.prevCx) * 4));
        }
        top.balRot = abs(target) >= abs(top.balRot) ? target : top.balRot * 0.55 + target * 0.45;
        if (abs(top.balRot) < 0.4) top.balRot = 0;
      }
      for (const e of allActiveEnts()) e.prevCx = getEntWorldCx(e);
    };

    // ── 生态联动辅助：打盹 z / 迷你蟹互动路径 ─────────────────────────────
    // 打盹符号：日间打盹冒 z（小→中→大），深夜（23:00~05:00）吹轻柔睡眠小鼻泡
    const dozeSymFor = (a) => {
      const offNight = Number(a.phaseOff) || 0;
      const offDay = (offNight * 2 + (a.kind === 'cat' ? 1 : a.kind === 'whale' ? 3 : 0)) % 18;
      if (isLateNight()) {
        if (reducedMotion) return 'sleepBubble0';
        const ph = (tickIdx + offNight) % 12;
        return ph < 6 ? 'sleepBubble0' : 'sleepBubble1';
      }
      if (reducedMotion) return 'dozeZ1';
      const ph = (tickIdx + offDay) % 18;
      return ph < 4 ? 'dozeZ0' : ph < 8 ? 'dozeZ1' : ph < 12 ? 'dozeZ2' : null;
    };
    const crabRiding = () =>
      miniPileEnabled && miniCrabs.some((mc) => mc.act && mc.act.type === 'ride' && tickIdx >= mc.act.start);

    // 迷你蟹分段路径求值：返回 { x, y, sprite, mirror, hopPx }；未激活或结束返回 null
    const miniActPose = (mc, baseSprite, anim) => {
      const act = mc.act;
      if (!act) return null;
      const t = tickIdx - act.start;
      if (t < 0) return null;
      let k0 = t;
      let segIdx = -1;
      for (let i = 0; i < act.segs.length; i++) {
        if (k0 < act.segs[i].ticks) {
          segIdx = i;
          break;
        }
        k0 -= act.segs[i].ticks;
      }
      if (segIdx < 0 || (act.abort && act.abort(segIdx))) {
        mc.act = null;
        if (segIdx >= 0 && act.onAbort) act.onAbort();
        return null;
      }
      const seg = act.segs[segIdx];
      const k = (k0 + 1) / seg.ticks;
      const x = seg.x0 + (seg.x1 - seg.x0) * k;
      const y = seg.y0 + (seg.y1 - seg.y0) * k - (seg.arc || 0) * sin(PI * k);
      if (seg.x1 !== seg.x0) mc.mirror = seg.x1 < seg.x0;
      else if (seg.face) mc.mirror = seg.face < 0;
      const still = MINI_SPRITES[mc.id];
      const blinking = tickIdx - mc.blinkAt >= 0 && tickIdx - mc.blinkAt < 2;
      let sprite;
      if (seg.sprite === 'walk') sprite = tickIdx % 2 ? anim.walkB : still;
      else if (seg.sprite === 'trick') sprite = anim.trick;
      else if (seg.sprite === 'wave') sprite = reducedMotion || k0 % 4 < 2 ? anim.trick : still;
      else if (seg.sprite === 'sit') sprite = k0 >= 8 && k0 < 14 && k0 % 4 < 2 ? anim.trick : blinking ? miniBlinkFrame(still) : still;
      else sprite = blinking ? miniBlinkFrame(still) : still;
      return {
        x: round(x),
        y: round(y / 2) * 2,
        sprite: sprite || baseSprite,
        mirror: mc.mirror,
        hopPx: seg.hop && !reducedMotion && k0 % 4 < 2 ? -2 : 0,
      };
    };

    // 迷你蟹坐标：translateX 相对迷你堆左缘（宿主 left 12px），精灵中心在画布 20px 处
    const crabHostCenter = (mc) => 12 + mc.lastX + 20;
    const crabSafeX = (x) => min(clampActorX(9999) - 132, max(2, round(x)));
    const crabMaxX = () => max(40, readStageWidth() - 52);
    const nearestFreeCrab = (hx) =>
      miniCrabs
        .filter((mc) => !mc.act || tickIdx - mc.act.start < 0)
        .sort((m1, m2) => abs(crabHostCenter(m1) - hx) - abs(crabHostCenter(m2) - hx))[0] || null;
    const actorFree = (a, now) =>
      !a.dragging && !a.ballisticActive && !a.stackedOn && !a.seq && a.y === 0 && !(a.overridePose === 'dangle' && now < a.overrideUntil);

    // 迎宾：三蟹集体挥手（复用 trick 帧，错峰 2 拍起手）
    const crabsWave = () => {
      if (!miniPileEnabled) return;
      miniCrabs.forEach((mc, idx) => {
        if (mc.act && mc.act.type === 'ride') return;
        const x = crabSafeX(mc.lastX);
        mc.act = {
          type: 'wave',
          start: tickIdx + 1 + idx * 2,
          segs: [{ ticks: 14, x0: x, x1: x, y0: 0, y1: 0, sprite: 'wave', hop: true }],
        };
      });
    };

    // 抛掷落地砸在蟹附近：受惊跳开 → 定住 → 慢慢走回原位
    const scatterCrabsNear = (hx) => {
      if (!miniPileEnabled || reducedMotion) return;
      miniCrabs.forEach((mc, idx) => {
        if (mc.act && mc.act.type === 'ride') return;
        const d = crabHostCenter(mc) - hx;
        if (abs(d) >= 64) return;
        const dir = d >= 0 ? 1 : -1;
        const x0 = crabSafeX(mc.lastX);
        const far = max(0, min(crabMaxX(), x0 + dir * 26));
        mc.act = {
          type: 'scatter',
          start: tickIdx + (idx % 2),
          segs: [
            { ticks: 5, x0, x1: far, y0: 0, y1: 0, arc: 6, sprite: 'walk' },
            { ticks: 4, x0: far, x1: far, y0: 0, y1: 0, sprite: 'still', face: -dir },
            { ticks: 9, x0: far, x1: x0, y0: 0, y1: 0, sprite: 'walk' },
          ],
        };
      });
    };

    let crabSerial = 0;
    // 小猫追蟹：一只迷你蟹跑到猫（或任意在场主宠）跟前挑衅 → 惊觉追几步 → 蟹逃回原位 → 歪头
    const runCrabChase = (force) => {
      const now = nowMs();
      const cat = actors.cat || activeMainActors().find((a) => a.kind === 'cat') || activeMainActors()[0];
      if (!cat || !miniPileEnabled || reducedMotion || dozing || !actorFree(cat, now)) return false;
      if (!force && stageBusy()) return false;
      const mc = nearestFreeCrab(cat.x + 48);
      if (!mc) return false;
      const x0 = crabSafeX(mc.lastX);
      const crabLeft = x0 + 20 + 12 < cat.x + 48;
      const tx = max(0, min(crabMaxX(), crabLeft ? cat.x - 26 : cat.x + 58));
      const catDir = crabLeft ? -1 : 1;
      const dist = abs(tx - x0);
      const approach = clamp(round(dist / 7), 3, 36);
      const flee = clamp(round(dist / 10), 4, 28);
      const act = {
        type: 'chase',
        start: tickIdx + 1,
        segs: [
          { ticks: approach, x0, x1: tx, y0: 0, y1: 0, sprite: 'walk' },
          { ticks: 6, x0: tx, x1: tx, y0: 0, y1: 0, sprite: 'wave', face: -catDir },
          { ticks: flee, x0: tx, x1: x0, y0: 0, y1: 0, sprite: 'walk', hop: true },
        ],
      };
      mc.act = act;
      const serial = (crabSerial += 1);
      const alive = () => serial === crabSerial && !disposed && !reducedMotion && actors[cat.id] === cat && !cat.dragging && !cat.stackedOn && !dozing;
      const t0 = (approach + 1) * TICK;
      later(t0, () => {
        if (!alive()) return;
        startClip(cat, 'wow', 500, { sym: 'bang' });
        renderAllFrames();
      });
      later(t0 + 500, () => {
        if (!alive()) return;
        startClip(cat, 'walk', 1200, { patrolDir: catDir, mirror: catDir > 0, sym: 'spark', symDurationMs: 600 });
      });
      later(t0 + 1750, () => {
        if (!alive()) return;
        startClip(cat, 'tilt', 900, { rot: -9, sym: 'q' });
        renderAllFrames();
      });
      later(t0 + 2750, () => {
        if (alive() && !stageBusy()) resetHomePositions(true);
      });
      return true;
    };

    // 迷你蟹骑头：走到 Clawd（或任意在场主宠）脚边 → 整格弧线跳上头顶坐一会儿（中途挥手）→ 跳下走回
    const runCrabRide = (force) => {
      const now = nowMs();
      const clawd = actors.clawd || activeMainActors().find((a) => a.kind === 'clawd') || activeMainActors()[0];
      if (!clawd || !miniPileEnabled || reducedMotion || dozing || yieldMode !== 'none') return false;
      if (!actorFree(clawd, now) || findDirectRider(clawd.id)) return false;
      if (!force && stageBusy()) return false;
      const mc = nearestFreeCrab(clawd.x + 48);
      if (!mc) return false;
      const x0 = crabSafeX(mc.lastX);
      const clawdX0 = clawd.x;
      // Clawd 头顶（y=0 行顶边）距宿主底 33px，迷你蟹脚底距宿主底 11px → 上移 22px；水平居中对齐 48px / 20px
      const headX = round(clawd.x + 16);
      const headY = -22;
      const side = x0 + 32 < clawd.x + 48 ? -1 : 1;
      const sideX = max(0, min(crabMaxX(), headX + side * 36));
      const approach = max(1, min(36, round(abs(sideX - x0) / 7)));
      const SIT = 22;
      const act = {
        type: 'ride',
        start: tickIdx + 1,
        segs: [
          { ticks: approach, x0, x1: sideX, y0: 0, y1: 0, sprite: 'walk' },
          { ticks: 4, x0: sideX, x1: headX, y0: 0, y1: headY, arc: 10, sprite: 'trick' },
          { ticks: SIT, x0: headX, x1: headX, y0: headY, y1: headY, sprite: 'sit', face: -side },
          { ticks: 4, x0: headX, x1: sideX, y0: headY, y1: 0, arc: 8, sprite: 'trick' },
          { ticks: max(2, approach), x0: sideX, x1: x0, y0: 0, y1: 0, sprite: 'walk' },
        ],
        // 宿主被拖走 / 移除 / 起飞 / 位移 / 叠叠乐时，蟹立即放弃骑头回到原位
        abort: (segIdx) =>
          segIdx >= 1 &&
          segIdx <= 3 &&
          (actors[clawd.id] !== clawd ||
            clawd.dragging ||
            clawd.stackedOn ||
            findDirectRider(clawd.id) ||
            clawd.y !== 0 ||
            abs(clawd.x - clawdX0) > 2 ||
            yieldMode !== 'none' ||
            dozing),
        onAbort: () => {
          if (clawd.overridePose === 'carry') clawd.overrideUntil = 0;
        },
      };
      mc.act = act;
      const tLand = (1 + approach + 4) * TICK;
      later(tLand, () => {
        if (mc.act !== act || actors[clawd.id] !== clawd) return;
        startClip(clawd, 'carry', SIT * TICK + 60);
        renderAllFrames();
      });
      later(tLand + (SIT + 4) * TICK, () => {
        if (mc.act !== act || actors[clawd.id] !== clawd) return;
        startClip(clawd, 'happy', 700, { sym: 'spark' });
        renderAllFrames();
      });
      return true;
    };

    // 舞台棱镜像素星屑渲染器（无粒子时自动缩回 0×0 释放 GPU 显存纹理，0 常驻开销）
    const stepAndPaintChromaFx = () => {
      if (!chromaSparks.length) {
        if (!fxCanvasCleared || fxCanvas.width || fxCanvas.height) releaseFxCanvas();
        return;
      }
      fxCanvasCleared = false;
      const wCss = max(240, readStageWidth());
      const hCss = 160;
      const tw = round(wCss * dpr);
      const th = round(hCss * dpr);
      if (fxCanvas.style?.display === 'none') fxCanvas.style.display = '';
      if (fxCanvas.width !== tw || fxCanvas.height !== th) {
        fxCanvas.width = tw;
        fxCanvas.height = th;
        if (fxCanvas.style) { fxCanvas.style.width = `${wCss}px`; fxCanvas.style.height = `${hCss}px`; }
      }
      const ctx = fxCanvas._ctx || (fxCanvas._ctx = fxCanvas.getContext('2d'));
      if (!ctx) { chromaSparks.length = 0; releaseFxCanvas(); return; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, wCss, hCss);
      ctx.imageSmoothingEnabled = false;
      for (let i = chromaSparks.length - 1; i >= 0; i--) {
        const sp = chromaSparks[i];
        sp.life += 1;
        if (sp.life > sp.maxLife) { chromaSparks.splice(i, 1); continue; }
        sp.x += sp.vx;
        sp.y += sp.vy;
        sp.vy += 0.28;
        ctx.fillStyle = sp.life % 3 === 1 ? '#FFFFFF' : sp.color;
        ctx.fillRect(round(sp.x / PX) * PX, round((hCss - 8 + sp.y) / PX) * PX, sp.size, sp.size);
      }
      if (!chromaSparks.length) releaseFxCanvas();
    };

    let lastChromaStepTick = -1;
    const renderAllFrames = (now = nowMs()) => {
      if (isVramSleepState()) {
        reclaimStageVram();
        return;
      }
      restoreStageVram();
      syncStageDpr();
      renderHabitatProp(false);
      if (prismaticCoat && !reducedMotion && !dozing && lastChromaStepTick !== tickIdx) {
        lastChromaStepTick = tickIdx;
        if (tickIdx % 3 === 0) {
          chromaPhase = (chromaPhase + 1 / 12) % 1;
        }
      }
      syncAllStackedFollowers();

      for (const id of activeMainIds()) {
        const a = actors[id];
        if (!a || !a.canvas) continue;
        let pose = resolvePoseFor(a, now);
        const st = seqStep(a);

        // 待机巡逻位移（每拍定步推进，底下散步时稳稳驮着头顶整串伙伴同步移动）
        if (pose === 'walk' && !a.dragging && !a.stackedOn && !a.leap && now < a.overrideUntil && !reducedMotion && a.walkStepTick !== tickIdx) {
          a.walkStepTick = tickIdx;
          const stepPx = now < a.passBoostUntil ? 1.4 * 1.55 : 1.4;
          a.x = clampActorX(a.x + a.patrolDir * stepPx);
          if (a.x <= 12 || a.x >= clampActorX(9999) - 2) a.patrolDir *= -1;
          syncAllStackedFollowers();
        }

        // 自动搭便车超时后轻巧侧跳落地
        if (a.stackedOn && a.perchUntil > 0 && now >= a.perchUntil && !a.dragging) {
          a.perchUntil = 0;
          const prevY = computeWorldFootY(a);
          const jumpDir = a.kind === 'cat' ? 1 : -1;
          a.stackedOn = null;
          resetActorTransient(a, { keepFly: true });
          a.y = prevY;
          startBallistic(a, jumpDir * 2.8, -3.6, { noSnap: true });
        }

        // 主动抛物线撑跳越过 / 搭便车跃上（Leapfrog / AutoPerch，峰值 ~26px）
        if (a.leap && !a.dragging) {
          const lp = a.leap;
          const k = min(1, (tickIdx - lp.startTick + 1) / max(1, lp.ticks));
          const cx = lp.cx0 + (lp.cx1 - lp.cx0) * k;
          setEntWorldCx(a, cx);
          a.y = -round(lp.peak * sin(PI * k));
          pose = k < 1 ? 'spinHop' : 'idle';
          if (k >= 1) {
            a.leap = null;
            a.y = 0;
            if (lp.landOnto) {
              const holder = getEnt(lp.landOnto);
              if (holder && !holder.dragging && getTowerMembers(holder.id).length < maxTowerDepthAllowed()) {
                a.stackedOn = holder.id;
                a.perchUntil = now + 7600;
                a.sym = 'heart';
                a.symUntil = now + 1000;
                playSeq(a, [['happy', 1, 2, -1, 0]]);
                syncAllStackedFollowers();
              } else {
                playSeq(a, [['idle', 1, 2, -1, 0]]);
                enforceGroundSeparation();
              }
            } else {
              playSeq(a, [['idle', 1, 2, -1, 0]]);
              enforceGroundSeparation();
            }
          }
          syncAllStackedFollowers();
        }

        // 叠叠乐上层失衡：张钳/张爪
        if (a.stackedOn && pose === 'idle' && abs(a.balRot) > 1.5) pose = 'balance';

        const sym =
          inspectState
            ? inspectState.sym || null
            : a.sym && now < a.symUntil
              ? a.sym
              : dozing && pose === 'sleep'
                ? dozeSymFor(a)
                : pose === 'sleep' || pose === 'loaf'
                  ? tickIdx % 8 < 4
                    ? 'z1'
                    : 'z2'
                  : pose === 'angry'
                    ? 'vein'
                    : null;
        const localTick = inspectState
          ? inspectState.tick
          : pose === 'write'
            ? streamTier >= 3
              ? tickIdx
              : floor(tickIdx / 2)
            : tickIdx;
        const fx = updateIdleFx(a, pose, now);
        a.lastFx = fx;
        const hasRider = Boolean(findDirectRider(id));
        const effectivePose = inspectState ? inspectState.pose : hasRider && pose === 'idle' ? 'squash' : pose;
        const sulkJitter = effectivePose === 'sulk' && !reducedMotion && !inspectState ? (tickIdx % 4 < 2 ? 0 : -PX) : 0;
        const liftPx = st?.lift && !reducedMotion ? st.lift * PX : 0;
        const nodOffset = (now < a.nodUntil ? a.nodY : 0) + sulkJitter + liftPx;
        let sqW = inspectState ? inspectState.sqW : st ? st.sqW : 0;
        let sqH = inspectState ? inspectState.sqH : st ? st.sqH : 0;
        if (!inspectState && !st && hasRider && pose !== 'idle') sqH = -1;
        a.lastSq = { w: sqW, h: sqH };
        const ftk = tickIdx - a.forceTwitchStart;
        const forcedTwitch = ftk >= 0 && ftk < 4 && ftk !== 2 ? a.forceTwitchSide : null;

        const crystalActive = id === 'clawd' && orchestrator && !hasRider && !crabRiding();
        const layers = buildClipLayers(a.kind, effectivePose, localTick, {
          clipTick: inspectState ? inspectState.tick : max(0, tickIdx - a.clipStartTick),
          sym,
          blinkStage: inspectState ? null : fx.blinkStage,
          breath: inspectState ? false : fx.breath,
          earTwitch: inspectState ? null : forcedTwitch || fx.earTwitch,
          clawSnap: inspectState ? null : fx.clawSnap,
          clipParam: a.clipParam,
          reduced: reducedMotion,
          crystal: crystalActive,
          crystalBob: !reducedMotion && floor(tickIdx / 6) % 2 === 1,
          eyeScan: inspectState ? 0 : a.eyeScan || fx.glance,
          noShadow: a.dragging || a.y < -2 || !!a.stackedOn,
          dir: a.faceDir || (a.vx < 0 || a.patrolDir < 0 ? 'left' : 'right'),
        });

        const isChromaCat = a.kind === 'cat' && prismaticCoat;
        const phaseBucket = isChromaCat ? round(chromaPhase * 12) : 0;
        const earSparkPhase = isChromaCat ? floor(tickIdx / 2) % 10 : -1;
        if (
          isChromaCat &&
          !reducedMotion &&
          (a.dragging || a.leap || a.y < -3 || (st?.lift) || (effectivePose === 'walk' && now < a.overrideUntil))
        ) {
          spawnChromaBurst(getEntWorldCx(a), computeWorldFootY(a) - 6, 1, true);
        }

        const flip = inspectState ? inspectState.mirror : !!a.mirror;
        const rulerOn = !!(inspectState?.ruler);
        let bLv = 0;
        let bDir = 0;
        if (!inspectState && rim.on) {
          const dx = getEntWorldCx(a) - rim.x;
          const fy = a.stackedOn ? computeWorldFootY(a) : (a.y || 0);
          bLv = round(rim.s * max(0, 1 - abs(dx) / 240) * max(0, 1 - abs(fy) / 48) * 12);
          if (bLv > 0) bDir = clamp(round(-dx / 55), -2, 2);
        }
        const tintState = `${a.kind}:${crystalActive ? 1 : 0}:${rulerOn ? 1 : 0}:${isChromaCat ? `p${phaseBucket}_${earSparkPhase}` : '0'}${bLv ? `:r${bLv}_${bDir}_${rim.t}_${rim.d ? 1 : 0}` : ''}`;
        const snappedTy = round(Number(nodOffset || 0) / PX) * PX;
        const frameIdx = computeLayersFrameIdx(layers);
        const rc = a.lastRender;
        // 像素层仅在精灵帧/朝向/表情/挤压/尺寸等真实像素内容变化时重绘，物理位移与倾角 rot 由 GPU transform 实时驱动
        if (
          rc.poseKey === effectivePose &&
          rc.frameIdx === frameIdx &&
          rc.flip === flip &&
          rc.tintState === tintState &&
          rc.tyPx === snappedTy &&
          rc.sqW === sqW &&
          rc.sqH === sqH &&
          rc.cw === a.canvas.width &&
          rc.ch === a.canvas.height
        ) {
          perfStats.canvasSkips += 1;
        } else {
          rc.poseKey = effectivePose;
          rc.frameIdx = frameIdx;
          rc.flip = flip;
          rc.tintState = tintState;
          rc.tyPx = snappedTy;
          rc.sqW = sqW;
          rc.sqH = sqH;
          rc.cw = a.canvas.width;
          rc.ch = a.canvas.height;
          const colorResolver = isChromaCat
            ? (ch, gx, gy, pal) =>
                ch === '#'
                  ? evalChromaColorAt(gx, gy, chromaPhase, false)
                  : ch === 's'
                    ? evalChromaColorAt(gx, gy, chromaPhase, true)
                    : pal[ch]
            : null;
          const overlayPainter =
            rulerOn || (isChromaCat && (earSparkPhase < 3 || (earSparkPhase >= 5 && earSparkPhase < 8)))
              ? (c2, oxG, oyG, pxS) => {
                  if (isChromaCat && (earSparkPhase < 3 || (earSparkPhase >= 5 && earSparkPhase < 8))) {
                    const leftEar = earSparkPhase < 3;
                    const sx = (oxG + (leftEar ? 2 : 13)) * pxS;
                    const sy = (oyG - 3) * pxS;
                    c2.fillStyle = '#FFFFFF';
                    c2.fillRect(sx, sy, pxS, pxS);
                    if (earSparkPhase === 1 || earSparkPhase === 6) {
                      c2.fillRect(sx - pxS, sy, pxS, pxS);
                      c2.fillRect(sx + pxS, sy, pxS, pxS);
                      c2.fillRect(sx, sy - pxS, pxS, pxS);
                      c2.fillRect(sx, sy + pxS, pxS, pxS);
                    }
                  }
                  if (rulerOn) {
                    const y9 = (oyG + 10) * pxS - 1;
                    c2.fillStyle = 'rgba(234,67,53,0.92)';
                    c2.fillRect(0, y9, (oxG + 20) * pxS, 1);
                  }
                }
              : null;
          const rimPainter =
            bLv > 0
              ? (c2, cw, oxG, oyG, pxS) => {
                  if (typeof c2.createRadialGradient !== 'function') return;
                  const p = RIM_PALS[rim.t] || RIM_PALS.default;
                  const o = rim.d ? 0 : 2;
                  const lv = (bLv / 12) * (rim.d ? 1 : 0.65);
                  const by = (oyG + 10) * pxS;
                  const gx = (oxG + 8) * pxS + bDir * 9;
                  const paint = (yy, r, h, s0, s1) => {
                    const g = c2.createRadialGradient(gx, yy, 0, gx, yy, r);
                    g.addColorStop(0, s0);
                    if (s1) g.addColorStop(0.5, s1);
                    g.addColorStop(1, `rgba(${p[o + (s1 ? 1 : 0)]},0)`);
                    c2.fillStyle = g;
                    c2.fillRect(0, max(0, by - h), cw, h);
                  };
                  c2.save();
                  c2.globalCompositeOperation = 'source-atop';
                  paint(by + 2, 34, 30, `rgba(${p[o]},${(0.36 * lv).toFixed(3)})`, `rgba(${p[o + 1]},${(0.16 * lv).toFixed(3)})`);
                  paint(by, 26, pxS, `rgba(${p[o]},${(0.3 * lv).toFixed(3)})`, '');
                  c2.restore();
                }
              : null;
          renderPixelLayers(a.canvas, dpr, OX, OY, PX, PALETTES[a.kind], layers, {
            ctx: a._ctx,
            mirror: flip,
            tyPx: snappedTy,
            sqW,
            sqH,
            rotDeg: 0,
            colorResolver,
            overlayPainter,
            rimPainter,
          });
          perfStats.canvasDraws += 1;
        }
      }

      const nextMiniDisplay = miniPileEnabled ? 'flex' : 'none';
      if (lastMiniDisplay !== nextMiniDisplay) {
        lastMiniDisplay = nextMiniDisplay;
        miniGroupEl.style.display = nextMiniDisplay;
      }
      if (miniPileEnabled) {
        const safeRight = max(48, (stageBoundsX().maxX || 680) - 48);
        if (!reducedMotion && !dozing && yieldMode !== 'peek' && lastCrabStepTick !== tickIdx) {
          lastCrabStepTick = tickIdx;
          const freeCorridorCrabs = miniCrabs.filter((mc) => !mc.dragging && !mc.ballisticActive && !mc.stackedOn && !mc.leap && mc.y === 0);
          const crabEvs = stepMiniCrabCorridor(freeCorridorCrabs, {
            minX: 2,
            maxX: safeRight,
            contactDist: 26,
            nowTick: tickIdx,
          });
          if (crabEvs.length) {
            recordInteraction(crabEvs[0].type, crabEvs[0].pair, now);
          }
        }
        syncAllStackedFollowers();
        miniCrabs.forEach((mc, idx) => {
          const anim = MINI_ANIM_FRAMES[mc.id];
          const moving = !reducedMotion && !dozing && yieldMode !== 'peek';

          // 自动搭便车超时后轻巧侧跳落地
          if (mc.stackedOn && mc.perchUntil > 0 && now >= mc.perchUntil && !mc.dragging) {
            mc.perchUntil = 0;
            const prevY = computeWorldFootY(mc);
            const jumpDir = idx % 2 === 0 ? -1 : 1;
            mc.stackedOn = null;
            mc.y = prevY;
            startMiniBallistic(mc, jumpDir * 2.8, -3.6, { noSnap: true });
          }

          // 抛物线撑跳越过推进
          if (mc.leap && !mc.dragging) {
            const lp = mc.leap;
            const k = min(1, (tickIdx - lp.startTick + 1) / max(1, lp.ticks));
            const cx = lp.cx0 + (lp.cx1 - lp.cx0) * k;
            setEntWorldCx(mc, cx);
            mc.y = -round(lp.peak * sin(PI * k));
            if (k >= 1) {
              mc.leap = null;
              mc.y = 0;
              if (lp.landOnto) {
                const holder = getEnt(lp.landOnto);
                if (holder && !holder.dragging && getTowerMembers(holder.id).length < maxTowerDepthAllowed()) {
                  mc.stackedOn = holder.id;
                  mc.perchUntil = now + 7200;
                  syncAllStackedFollowers();
                } else {
                  enforceGroundSeparation();
                }
              } else {
                enforceGroundSeparation();
              }
            }
          }

          const cycle = (tickIdx + idx * 7) % 24;
          const isTrick = moving && !mc.stackedOn && cycle >= 18;
          const inBump = moving && tickIdx < mc.bumpUntilTick;
          const inPassHop = moving && tickIdx < mc.passHopUntilTick;
          let sprite = mc.dragging
            ? tickIdx % 2 === 0
              ? anim.walkB
              : MINI_SPRITES[mc.id]
            : mc.leap
              ? anim.trick
              : mc.stackedOn
                ? cycle >= 20
                  ? anim.trick
                  : MINI_SPRITES[mc.id]
                : inBump
                  ? anim.trick
                  : isTrick && !inPassHop
                    ? anim.trick
                    : moving && tickIdx % 4 >= 2
                      ? anim.walkB
                      : MINI_SPRITES[mc.id];
          if (tickIdx >= mc.nextBlink) {
            mc.blinkAt = tickIdx;
            mc.nextBlink = tickIdx + ticksIn(2600, 6500);
          }
          if (!mc.dragging && tickIdx - mc.blinkAt >= 0 && tickIdx - mc.blinkAt < 2 && !isTrick && !inBump) {
            sprite = miniBlinkFrame(sprite);
          }
          const tc = cycle - 18;
          let hopPx = 0;
          if (!mc.dragging && !mc.stackedOn && !mc.leap) {
            if (inPassHop) {
              const rem = mc.passHopUntilTick - tickIdx;
              hopPx = rem === 2 || rem === 3 ? -4 : -2;
            } else if (inBump) {
              hopPx = -2;
            } else if (moving) {
              const hopCells = isTrick
                ? tc === 1 || tc === 2
                  ? -1
                  : 0
                : (tickIdx + idx * 3) % 14 === 0
                  ? -1
                  : 0;
              hopPx = hopCells * 2;
            }
          }

          const actPos = !mc.dragging && !mc.stackedOn && !mc.leap ? miniActPose(mc, sprite, anim) : null;
          const targetSprite = actPos ? actPos.sprite : sprite;
          const targetMirror = actPos ? !!actPos.mirror : !!(moving && mc.dir < 0);
          const targetTy = actPos ? actPos.hopPx : hopPx;
          const mcDirect = syncDirectMotionDomAttr(mc, mc.canvas);
          let targetX;
          let targetY;
          if (mc.stackedOn && !mc.dragging) {
            const root = getTowerRoot(mc.id);
            const wCx = getEntWorldCx(root || mc);
            targetX = snapCoord(wCx - 32, mcDirect);
            targetY = snapCoord(computeWorldFootY(mc) + (yieldMode === 'peek' ? PEEK_Y : 0), mcDirect);
            mc.px = targetX;
            mc.lastX = round(targetX);
          } else if (actPos) {
            targetX = actPos.x;
            targetY = actPos.y;
            if (actPos.y === 0) {
              mc.lastX = clamp(actPos.x, 2, safeRight);
              mc.px = mc.lastX;
            }
          } else {
            const rawX = mc.dragging
              ? mc.px
              : moving
                ? clamp(mc.px, 2, safeRight)
                : clamp(mc.px ?? mc.x, 2, safeRight);
            targetX = snapCoord(rawX, mcDirect);
            targetY = snapCoord((mc.y || 0) + (yieldMode === 'peek' && !mc.dragging && !mc.stackedOn && !mc.leap ? MINI_PEEK_Y : 0), mcDirect);
            mc.lastX = round(targetX);
          }

          const mz = miniZ(mc);
          const mKey = `${computeLayersFrameIdx([targetSprite])}|${targetMirror ? 1 : 0}|${targetTy}|${mc.canvas.width}`;
          if (mc.lastFrameKey !== mKey) {
            mc.lastFrameKey = mKey;
            renderPixelLayers(mc.canvas, dpr, 2, 5, 2, PALETTES[mc.id], [targetSprite], {
              ctx: mc._ctx,
              mirror: targetMirror,
              tyPx: targetTy,
            });
          }
          applyMiniTransform(mc, targetX, targetY, mz, mc.dragging || mc.ballisticActive ? mc.rot : 0);
        });
      } else {
        miniCrabs.forEach((mc) => {
          mc.act = null;
          mc.stackedOn = null;
          mc.dragging = false;
          mc.ballisticActive = false;
          mc.rot = 0;
          mc.y = 0;
        });
        syncMascotDragRootAttr();
      }

      const draggingMain = activeMainActors().find((a) => a.dragging);
      enforceGroundSeparation(
        draggingMain ? draggingMain.id : (miniCrabs.find((m) => m.dragging) || {}).id || null
      );
      // 二次刷新被防重叠微调后的 DOM transform（若未变则自动命中缓存 0 写入）
      for (const a of activeMainActors()) applyActorTransform(a, now);
      if (miniPileEnabled) {
        const miniPeekY = yieldMode === 'peek' ? MINI_PEEK_Y : 0;
        for (const mc of miniCrabs) {
          if (!mc.dragging && !mc.ballisticActive && !mc.stackedOn && !mc.act && !mc.leap && mc.y === 0) {
            syncDirectMotionDomAttr(mc, mc.canvas);
            const tx = round(mc.px);
            applyMiniTransform(mc, tx, miniPeekY, null, 0);
          }
        }
      }
      stepAndPaintChromaFx();
    };

    const startClip = (actor, pose, durationMs, opts = {}) => {
      const now = nowMs();
      actor.overridePose = pose;
      actor.overrideUntil = now + durationMs;
      actor.overrideRot = opts.rot || 0;
      actor.mirror = !!opts.mirror;
      actor.faceDir = opts.face || null;
      actor.clipParam = opts.param ?? null;
      actor.clipStartTick = tickIdx;
      if (opts.sym) {
        actor.sym = opts.sym;
        actor.symUntil = now + (opts.symDurationMs || durationMs);
      }
      if (opts.patrolDir) actor.patrolDir = opts.patrolDir;
    };

    // 统一清理角色瞬态姿态/物理状态，根治交叉打断导致的残余旋转/镜像/序列卡死
    const resetActorTransient = (ent, opts = {}) => {
      if (!ent) return;
      if (!opts.keepFly) ent.flying += 1;
      if (!opts.keepBallistic) ent.ballisticActive = false;
      ent.leap = null;
      if (!opts.keepVel) {
        ent.vx = 0;
        ent.vy = 0;
      }
      ent.rot = 0;
      if (isMiniEnt(ent)) {
        if (!opts.keepAct) ent.act = null;
        return;
      }
      if (!opts.keepPose) {
        ent.overridePose = null;
        ent.overrideUntil = 0;
      }
      ent.overrideRot = 0;
      ent.balRot = 0;
      if (!opts.keepMirror) ent.mirror = false;
      ent.faceDir = null;
      ent.clipParam = null;
      if (!opts.keepSeq) {
        ent.seq = null;
        ent.seqThen = null;
      }
    };

    // 减少动态开启：中止抛掷/巡逻/序列与星屑，回到静态待机
    function freezeMotion() {
      chromaSparks.length = 0;
      releaseFxCanvas();
      for (const a of activeMainActors()) {
        const keepPose = a.overridePose && a.overridePose !== 'walk' && a.overridePose !== 'dangle';
        resetActorTransient(a, { keepPose });
        a.passBoostUntil = 0;
        if (!a.stackedOn) a.y = 0;
      }
      miniCrabs.forEach((mc) => {
        resetActorTransient(mc, { keepAct: Boolean(mc.act && mc.act.type === 'wave') });
        mc.bumpUntilTick = -1;
        mc.passHopUntilTick = -1;
        mc.cooldownTick = -1;
        if (!mc.stackedOn) {
          mc.y = 0;
          mc.px = mc.x;
          mc.lastX = mc.x;
        }
      });
      for (const a of activeMainActors()) {
        if (a.overridePose === 'carry') a.overrideUntil = 0;
      }
      resetHomePositions(false);
    }

    const toggleChromaResonance = (now, targetCat = null) => {
      prismaticCoat = !prismaticCoat;
      writeChromaSaved(prismaticCoat);
      const cat = targetCat || actors.cat || activeMainActors().find((a) => a.kind === 'cat') || leaderActor();
      if (!cat) return;
      resetActorTransient(cat);
      const catCx = getEntWorldCx(cat);
      const catFootY = computeWorldFootY(cat);
      if (prismaticCoat) {
        spawnChromaBurst(catCx, catFootY - 18, 12, false);
        playSeq(cat, hopSteps('spinHop'));
        cat.sym = 'spark';
        cat.symUntil = now + 1500;
        recordInteraction('chromaAwaken', cat.id, now);
      } else {
        spawnChromaBurst(catCx, catFootY - 16, 6, true);
        startClip(cat, 'groom', 800, { sym: 'note' });
        recordInteraction('chromaRest', cat.id, now);
      }
    };

    // ── 五段递进戳戳气鼓鼓 + 叠塔连击四下切换隐藏棱彩形态 ────────────────────
    const triggerPoke = (actor, fromPointer) => {
      if (!actor) return;
      const now = nowMs();
      markActivity();

      if (actor.kind === 'cat') {
        const towerLen = getTowerMembers(actor.id).length;
        if (towerLen >= 2 && (prismaticCoat || (chromaGates.tuned && chromaGates.forged))) {
          while (chromaTapTimes.length && now - chromaTapTimes[0] > 2600) chromaTapTimes.shift();
          chromaTapTimes.push(now);
          if (chromaTapTimes.length >= 4) {
            chromaTapTimes.length = 0;
            actor.pokeCount = 0;
            toggleChromaResonance(now, actor);
            renderAllFrames(now);
            return;
          }
          startClip(actor, 'happy', 550, { sym: 'spark' });
          renderAllFrames(now);
          return;
        }
      }

      if (now - actor.lastPokeAt > 4500) actor.pokeCount = 0;
      actor.pokeCount += 1;
      actor.lastPokeAt = now;
      const inTower = getTowerMembers(actor.id).length >= 2;

      if (actor.pokeCount === 1) {
        const firstPose =
          actor.kind === 'cat' && random() < 0.45
            ? 'groom'
            : actor.kind === 'dragon' && random() < 0.55
              ? 'dragonFlame'
              : actor.kind === 'whale' && random() < 0.55
                ? 'whaleSpout'
                : 'happy';
        startClip(actor, firstPose, firstPose === 'dragonFlame' || firstPose === 'whaleSpout' ? 1400 : 750, { sym: 'spark' });
        if (fromPointer && !inTower) startBallistic(actor, 0, -4.4, { anticipate: true });
      } else if (actor.pokeCount === 2) {
        // 作废第 1 击可能挂起的 200ms 延迟弹射，防止 jiggle 被滞后弹飞打断
        actor.flying += 1;
        actor.seq = null;
        startClip(actor, 'jiggle', 950, { sym: 'note' });
      } else if (actor.pokeCount === 3) {
        actor.flying += 1;
        startClip(actor, 'tilt', 1100, { rot: -9, sym: 'q' });
      } else if (actor.pokeCount === 4) {
        startClip(actor, 'wow', 950, { sym: 'bang' });
        if (fromPointer && !inTower) startBallistic(actor, 0, -3.2, { anticipate: true });
      } else {
        actor.flying += 1;
        actor.pokeCount = 0;
        startClip(actor, 'sulk', 3200, { mirror: true, sym: 'vein' });
      }
      renderAllFrames(now);
    };

    // ── 紧凑时间轴剧本表驱动：日常剧场 + 彩蛋 + 合演（Batch 2 Slash 剧场复用此执行器）──
    const DAILY_BASE = 'letter,plant,butterfly,walk'.split(',');
    const DAILY_POOL = {
      clawd: [...'polish,eat,stretch,spinHop,wave,yawn'.split(','), ...DAILY_BASE],
      cat: [...'groom,eatFish,chaseDot,catStretch,yawnStretch'.split(','), ...DAILY_BASE],
      dragon: [...'dragonFlame,polish,eat,stretch,spinHop,wave,yawn'.split(','), ...DAILY_BASE],
      whale: [...'whaleSpout,eatFish,spinHop,wave,yawn'.split(','), ...DAILY_BASE],
    };
    const DAILY_WEIGHTS = { wave: 1.3, yawn: 0.6, yawnStretch: 1.1, dragonFlame: 2.2, whaleSpout: 2.2 };
    const NIGHT_BOOST = new Set(['yawn', 'yawnStretch', 'stretch', 'catStretch']);
    const CLIP_MS = { wave: 1500, yawn: 1300, yawnStretch: 2200, dragonFlame: 2400, whaleSpout: 2400 };
    const isLateNight = () => {
      const h = new Date().getHours();
      return h >= 23 || h < 5;
    };
    const pickDaily = (pool) => {
      const night = isLateNight();
      const ws = pool.map((k) => (DAILY_WEIGHTS[k] ?? 1) * (night && NIGHT_BOOST.has(k) ? 3 : 1));
      let r = random() * ws.reduce((s, w) => s + w, 0);
      for (let i = 0; i < pool.length; i++) {
        r -= ws[i];
        if (r < 0) return pool[i];
      }
      return pool[pool.length - 1];
    };
    const EGGS = ['onFire', 'cheerSticks', 'rickroll', 'siren'];
    const DUETS = [['chatGreet', 0.4], ['lookNod', 0.25], ['catRub', 0.2], ['readAlong', 0.15]];
    const pickDuet = () => {
      let r = random();
      for (const [k, w] of DUETS) if ((r -= w) < 0) return k;
      return 'chatGreet';
    };

    const stageBusy = () =>
      streaming ||
      hasError ||
      yieldMode !== 'none' ||
      activeMainActors().some((a) => a.dragging || a.stackedOn) ||
      miniCrabs.some((m) => m.dragging || m.stackedOn);

    let duetSerial = 0;
    const THEATER_SCRIPTS = {
      lookNod: (ctx) => {
        const mains = ctx.mains;
        const steps = [];
        for (let i = 0; i < mains.length; i += 2) {
          const a = mains[i];
          const b = mains[i + 1];
          if (b) {
            const f = faceToward(a, b);
            steps.push([0, a.id, 'lookNod', 2000, { face: f, param: 5 }]);
            steps.push([0, b.id, 'lookNod', 2000, { face: f === 'right' ? 'left' : 'right', param: 9 }]);
          } else {
            steps.push([0, a.id, 'lookNod', 2000, { face: 'left', param: 5 }]);
          }
        }
        return { dur: 2500, steps };
      },
      readAlong: (ctx) => ({
        dur: 2500,
        steps: ctx.mains.map((a, idx) => [0, a.id, 'readAlong', 1600, idx % 2 === 0 ? { sym: 'note' } : {}]),
      }),
      chatGreet: (ctx) => ({
        dur: 2500,
        steps: [
          ...ctx.mains.map((a) =>
            a.kind === 'dragon'
              ? [0, a.id, 'dragonFlame', 2200, { sym: 'spark' }]
              : a.kind === 'whale'
                ? [0, a.id, 'whaleSpout', 2200, { sym: 'heart' }]
                : a.kind === 'cat'
                  ? [0, a.id, 'chatGreet', 2400, { mirror: true, sym: 'note' }]
                  : [0, a.id, 'chatGreet', 2400, { sym: 'heart' }]
          ),
          [0, 'crabsWave'],
        ],
      }),
      catRub: (ctx) => {
        const cat = ctx.mains.find((a) => a.kind === 'cat');
        const buddy = ctx.mains.find((a) => a !== cat && a.kind === 'clawd') || ctx.mains.find((a) => a !== cat);
        if (!cat || !buddy) return THEATER_SCRIPTS.chatGreet(ctx);
        const dir = buddy.x < cat.x ? -1 : 1;
        const wt = min(16, round(max(0, abs(buddy.x - cat.x) - 46) / 1.4));
        const wm = wt * TICK;
        const steps = [];
        if (wt >= 2) steps.push([0, cat.id, 'walk', wm, { patrolDir: dir }]);
        steps.push([wm, cat.id, 'groom', 1600, { mirror: dir < 0 }]);
        steps.push([wm + 400, buddy.id, 'pet', 1300, { sym: 'heart' }]);
        if (wt >= 2) steps.push([wm + 1700, cat.id, 'walk', wm, { patrolDir: -dir }]);
        steps.push([wm * 2 + 1800, 'resetHome']);
        return { dur: wm * 2 + 2000, steps };
      },
    };

    const runDuet = (name) => {
      const now = nowMs();
      const mains = activeMainActors();
      if (!mains.length) {
        if (miniPileEnabled) { crabsWave(); renderAllFrames(now); }
        return;
      }
      const specFn = THEATER_SCRIPTS[name] || THEATER_SCRIPTS.chatGreet;
      const spec = specFn({ mains, now });
      const serial = (duetSerial += 1);
      duetUntil = now + (spec.dur || 2500);
      const alive = () => serial === duetSerial && !disposed && !stageBusy() && !reducedMotion && !isHostSleeping() && !isWindowBlurred();
      const exec = (step) => {
        const [, who, pose, dur, opts] = step;
        if (who === 'crabsWave') crabsWave();
        else if (who === 'resetHome') resetHomePositions(false);
        else if (isFn(who)) who();
        else if (hasOwn(actors, who) && actors[who]) startClip(actors[who], pose, dur, opts || {});
      };
      for (const st of spec.steps) {
        if (!st[0]) exec(st);
        else later(st[0], () => { if (alive()) { exec(st); renderAllFrames(); } });
      }
      renderAllFrames(now);
    };

    const pickNextTheater = () => {
      if (disposed || isHostDetached() || parked) {
        theaterTimer = 0;
        return;
      }
      if (!stageBusy() && !reducedMotion && !dozing && !isHostSleeping() && !isWindowBlurred() && !isPpOpen()) {
        const now = nowMs();
        const mains = activeMainActors();
        const allIdle = mains.every((a) => !a.overridePose || now >= a.overrideUntil);
        const crabBusy = miniCrabs.some((mc) => mc.act);

        if (!mains.length) {
          if (miniPileEnabled && !crabBusy && random() < 0.35) {
            crabsWave();
            renderAllFrames(now);
          }
        } else if (miniPileEnabled && allIdle && !crabBusy && random() < 0.18) {
          const r = random();
          if (r < 0.4 ? runCrabChase(false) : r < 0.8 ? runCrabRide(false) : (crabsWave(), true)) renderAllFrames(now);
        } else if (allIdle && random() < 0.3) {
          runDuet(pickDuet());
        } else {
          const target = mains[theaterCursor % mains.length];
          theaterCursor += 1;
          if (!target.overridePose || now >= target.overrideUntil) {
            if (random() < 0.06) {
              startClip(target, EGGS[floor(random() * EGGS.length)], 3800);
            } else {
              const clip = pickDaily(DAILY_POOL[target.kind] || DAILY_POOL.clawd);
              startClip(target, clip, CLIP_MS[clip] || 3600, { patrolDir: random() < 0.5 ? -1 : 1 });
              if (clip === 'walk') {
                const walker = target;
                const backOk = () => !stageBusy() && !reducedMotion && actors[walker.id] === walker && !walker.seq && walker.y === 0 && !isHostSleeping();
                later(3700, () => { if (backOk()) startClip(walker, 'walk', 3600, { patrolDir: -walker.patrolDir }); });
                later(7400, () => { if (backOk()) resetHomePositions(true); });
              }
            }
            renderAllFrames(now);
          }
        }
      }
      if (!disposed && !dozing && !parked && !isHostDetached() && !isDocHidden() && !isHostSleeping() && !isWindowBlurred() && !isPpOpen()) {
        theaterTimer = setTimeout(pickNextTheater, 4600 + round(random() * 2600));
      } else {
        theaterTimer = 0;
      }
    };
    const scheduleTheater = (delayMs) => {
      clearTimeout(theaterTimer);
      theaterTimer = 0;
      if (disposed || dozing || parked || isHostDetached() || isDocHidden() || isHostSleeping() || isWindowBlurred() || isPpOpen()) return;
      theaterTimer = setTimeout(pickNextTheater, delayMs ?? 4600 + round(random() * 2600));
    };
    scheduleTheater(3800);

    // ── 多层图腾塔吸附、抽底重力顺滑补位、剧烈动作侧跳下塔与统一弹道引擎 ──────
    const trySnapOntoTower = (mover, now = nowMs()) => {
      if (!mover || mover.dragging) return false;
      const moverChain = getTowerMembers(mover.id);
      const maxDepth = maxTowerDepthAllowed();
      const moverCx = getEntWorldCx(mover);
      const moverFootY = mover.y || 0;
      const seenRoots = new Set(moverChain);

      for (const cand of allActiveEnts()) {
        const root = getTowerRoot(cand.id);
        if (!root || seenRoots.has(root.id)) continue;
        seenRoots.add(root.id);
        if (root.dragging || root.ballisticActive || root.leap || (root.y || 0) < -4) continue;
        if (!isMiniEnt(root) && now < root.overrideUntil && ['onFire', 'siren', 'spinHop'].includes(root.overridePose)) continue;
        const baseChain = getTowerMembers(root.id);
        if (baseChain.length + moverChain.length > maxDepth) continue;
        const top = getEnt(baseChain[baseChain.length - 1]);
        if (!top || top.dragging || top.ballisticActive || top.leap || ((top.y || 0) < -2 && !top.stackedOn)) continue;

        const perchY = computeWorldFootY(top) - mountStepH(top.id);
        if (abs(moverCx - getEntWorldCx(top)) <= 28 && moverFootY >= perchY - 24 && moverFootY <= perchY + 20) {
          resetActorTransient(mover, { keepFly: true });
          mover.stackedOn = top.id;
          mover.y = 0;
          mover.perchUntil = 0;
          if (!isMiniEnt(mover)) {
            mover.overridePose = 'happy';
            mover.overrideUntil = now + 950;
            mover.sym = 'heart';
            mover.symUntil = now + 1100;
            playSeq(mover, [['happy', 1, 2, -1]]);
          }
          syncAllStackedFollowers();
          renderAllFrames(now);
          return true;
        }
      }
      return false;
    };

    const startGravitySettle = (subRoot, targetHolderId) => {
      if (!subRoot) return;
      const subLen = getTowerMembers(subRoot.id).length;
      if (reducedMotion) {
        subRoot.flying += 1;
        subRoot.ballisticActive = false;
        const holder = targetHolderId ? getEnt(targetHolderId) : null;
        if (holder && !holder.dragging && getTowerMembers(holder.id).length + subLen <= maxTowerDepthAllowed()) {
          subRoot.stackedOn = holder.id;
          subRoot.y = 0;
          syncAllStackedFollowers();
        } else {
          subRoot.stackedOn = null;
          subRoot.y = 0;
          enforceGroundSeparation();
        }
        subRoot.vx = 0;
        subRoot.vy = 0;
        subRoot.rot = 0;
        renderAllFrames();
        return;
      }

      const settleId = (subRoot.flying += 1);
      subRoot.ballisticActive = true;
      syncDirectMotionDomAttr(subRoot, isMiniEnt(subRoot) ? subRoot.canvas : subRoot.el);
      let vy = 0.65;
      let prev = nowMs();
      const step = (now) => {
        if (disposed || settleId !== subRoot.flying || subRoot.dragging) {
          if (disposed || subRoot.dragging) subRoot.ballisticActive = false;
          return;
        }
        const k = max(0.5, min(2.5, (now - prev) / 16.6667));
        prev = now;
        let holder = targetHolderId ? getEnt(targetHolderId) : null;
        if (holder && (holder.dragging || getTowerMembers(holder.id).includes(subRoot.id) || getTowerMembers(holder.id).length + subLen > maxTowerDepthAllowed())) {
          holder = null;
        }
        const goalY = holder ? computeWorldFootY(holder) - mountStepH(holder.id) : 0;
        if (isDocHidden() || isHostSleeping() || parked) {
          subRoot.ballisticActive = false;
          subRoot.vx = 0;
          subRoot.vy = 0;
          subRoot.rot = 0;
          if (holder) {
            subRoot.stackedOn = holder.id;
            subRoot.y = 0;
            syncAllStackedFollowers();
          } else {
            subRoot.stackedOn = null;
            subRoot.y = 0;
            enforceGroundSeparation();
          }
          syncTower(subRoot, now);
          reclaimStageVram();
          return;
        }
        if (holder) {
          const curCx = getEntWorldCx(subRoot);
          setEntWorldCx(subRoot, curCx + (getEntWorldCx(holder) - curCx) * min(1, 0.35 * k));
        }
        vy = min(14, vy + 0.54 * k);
        subRoot.y += vy * k;
        subRoot.vy = vy;
        if (subRoot.y >= goalY) {
          subRoot.ballisticActive = false;
          subRoot.vx = 0;
          subRoot.vy = 0;
          subRoot.rot = 0;
          if (holder) {
            subRoot.stackedOn = holder.id;
            subRoot.y = 0;
            if (!isMiniEnt(subRoot)) playSeq(subRoot, [['idle', 1, 2, -1]]);
            syncAllStackedFollowers();
          } else {
            subRoot.stackedOn = null;
            subRoot.y = 0;
            if (!isMiniEnt(subRoot)) playSeq(subRoot, landingSteps(1));
            enforceGroundSeparation();
          }
          syncTower(subRoot, now);
          renderAllFrames(now);
          return;
        }
        syncAllStackedFollowers();
        syncTower(subRoot, now);
        rAF(step);
      };
      rAF(step);
    };

    const detachWithGravitySettle = (pulledId) => {
      const pulled = getEnt(pulledId);
      if (!pulled) return;
      const lowerHolderId = pulled.stackedOn || null;
      const upperRider = findDirectRider(pulledId);
      if (upperRider) {
        const riderStartFootY = computeWorldFootY(upperRider);
        const riderStartCx = getEntWorldCx(upperRider);
        upperRider.stackedOn = null;
        upperRider.perchUntil = 0;
        resetActorTransient(upperRider, { keepFly: true });
        setEntWorldCx(upperRider, riderStartCx);
        upperRider.y = riderStartFootY;
      }
      pulled.stackedOn = null;
      pulled.perchUntil = 0;
      if (upperRider) startGravitySettle(upperRider, lowerHolderId);
    };

    const dismountRidersSideHop = (baseId) => {
      const chain = getTowerMembers(baseId);
      const idx = chain.indexOf(baseId);
      if (idx < 0 || idx >= chain.length - 1) return false;
      const snapshots = chain
        .slice(idx + 1)
        .map((id) => getEnt(id))
        .filter(Boolean)
        .map((r) => ({ r, footY: computeWorldFootY(r), cx: getEntWorldCx(r) }));
      for (const s of snapshots) {
        s.r.stackedOn = null;
        s.r.perchUntil = 0;
        resetActorTransient(s.r, { keepFly: true });
        s.r.y = s.footY;
        setEntWorldCx(s.r, s.cx);
      }
      snapshots.forEach((s, i) => {
        const dir = i % 2 === 0 ? -1 : 1;
        if (reducedMotion) {
          setEntWorldCx(s.r, s.cx + dir * (28 + i * 18));
          s.r.y = 0;
        } else {
          const isM = isMiniEnt(s.r);
          startEntityBallistic(s.r, dir * ((isM ? 2.6 : 2.8) + i * 0.6), (isM ? -3.5 : -3.8) - i * 0.4, { noSnap: true });
        }
      });
      if (reducedMotion) {
        enforceGroundSeparation();
        renderAllFrames();
      }
      return true;
    };

    const triggerObstacleEncounter = (moverId, obstacleId, forcedAction = null) => {
      const mover = getEnt(moverId);
      const obs = getEnt(obstacleId);
      if (!mover || !obs || mover.id === obs.id) return null;
      const now = nowMs();
      const obsRoot = getTowerRoot(obs.id) || obs;
      if (obsRoot.id === mover.id) return null;

      const moverCx = getEntWorldCx(mover);
      const obsCx = getEntWorldCx(obsRoot);
      const dir = moverCx <= obsCx ? 1 : -1;
      const landCx = obsCx + dir * (entHalfW(obsRoot) + entHalfW(mover) + 12);
      const { minX, maxX } = stageBoundsX();
      const mHw = entHalfW(mover);
      const canLeap = landCx >= minX + mHw + 2 && landCx <= maxX - mHw - 2;
      const obsTowerLen = getTowerMembers(obsRoot.id).length;
      const canPerch = getTowerMembers(mover.id).length === 1 && obsTowerLen < maxTowerDepthAllowed();

      let action = forcedAction || chooseObstacleAction({ canLeap, canPerch });
      if (action === 'autoPerch' && !canPerch) action = canLeap ? 'leapfrog' : 'greetTurn';
      if (action === 'leapfrog' && !canLeap) action = canPerch ? 'autoPerch' : 'greetTurn';

      if (action === 'leapfrog') {
        const peak = min(62, 26 + max(0, obsTowerLen - 1) * 14);
        resetActorTransient(mover, { keepFly: true });
        if (reducedMotion) {
          setEntWorldCx(mover, landCx);
          mover.y = 0;
          enforceGroundSeparation();
        } else {
          mover.leap = { cx0: moverCx, cx1: landCx, peak, startTick: tickIdx, ticks: 6, landOnto: null };
          if (!isMiniEnt(mover)) {
            mover.faceDir = dir > 0 ? 'right' : 'left';
            mover.sym = 'spark';
            mover.symUntil = now + 750;
          }
        }
      } else if (action === 'autoPerch') {
        const top = getStackTop(obsRoot.id);
        resetActorTransient(mover, { keepFly: true });
        if (reducedMotion) {
          mover.stackedOn = top.id;
          mover.y = 0;
          mover.perchUntil = now + 7200;
          syncAllStackedFollowers();
        } else {
          const peak = max(26, abs(computeWorldFootY(top) - mountStepH(top.id)) + 10);
          mover.leap = { cx0: moverCx, cx1: getEntWorldCx(top), peak, startTick: tickIdx, ticks: 5, landOnto: top.id };
          if (!isMiniEnt(obsRoot) && !obsRoot.dragging && !obsRoot.stackedOn) {
            startClip(obsRoot, 'walk', 2800, { patrolDir: dir });
          }
        }
      } else {
        action = 'greetTurn';
        if (isMiniEnt(mover)) {
          mover.act = null;
          mover.bumpUntilTick = tickIdx + 6;
          mover.blinkAt = tickIdx;
          mover.dir = -dir;
          setEntWorldCx(mover, moverCx - dir * 4);
        } else {
          mover.nextBlinkTick = tickIdx;
          mover.patrolDir = -dir;
          startClip(mover, mover.kind === 'clawd' ? 'wave' : 'tilt', 560, {
            face: dir > 0 ? 'right' : 'left',
            sym: 'note',
            rot: mover.kind === 'cat' ? -8 : 0,
          });
          later(520, () => {
            if (!disposed && !stageBusy() && !reducedMotion && !dozing && !mover.dragging && !mover.stackedOn) {
              startClip(mover, 'walk', 2000, { patrolDir: -dir });
            }
          });
        }
        if (isMiniEnt(obsRoot)) {
          obsRoot.bumpUntilTick = tickIdx + 5;
          obsRoot.blinkAt = tickIdx;
        } else {
          obsRoot.nextBlinkTick = tickIdx;
          obsRoot.nodY = PX;
          obsRoot.nodUntil = now + 180;
        }
      }

      recordInteraction(action, `${mover.id}->${obsRoot.id}`, now);
      renderAllFrames(now);
      return action;
    };

    // 统一主宠 + 迷你蟹弹道物理循环
    const launchEntity = (ent, vx0, vy0, bopts = {}) => {
      const mini = isMiniEnt(ent);
      const flightId = (ent.flying += 1);
      const hasReboundTarget = !mini && typeof bopts.reboundTargetX === 'number' && isFin(bopts.reboundTargetX);
      const vLim = mini ? 14 : 18;
      const maxVx = hasReboundTarget ? 64 : vLim;
      let vx = clamp(vx0, -maxVx, maxVx);
      let vy = clamp(vy0, -vLim, vLim);
      let bounces = 0;
      let scattered = false;
      resetActorTransient(ent, { keepFly: true, keepVel: true, keepBallistic: true });
      ent.ballisticActive = true;
      if (!mini) {
        ent.reboundNoBump = !!bopts.reboundNoBump;
        ent.overridePose = 'dangle';
        ent.overrideUntil = nowMs() + 3000;
      }
      // 起跳瞬间立刻锁死 data-direct="1" 与 transition: none，防止首帧落入 220ms CSS transition
      syncDirectMotionDomAttr(ent, mini ? ent.canvas : ent.el);

      let prev = nowMs();
      const step = (now) => {
        if (disposed || flightId !== ent.flying || ent.dragging) {
          if (disposed || ent.dragging) ent.ballisticActive = false;
          return;
        }
        if (isDocHidden() || isHostSleeping() || parked) {
          if (hasReboundTarget) {
            ent.x = max(8, min(maxXFor(readStageWidth()), bopts.reboundTargetX));
          }
          if (!mini) ent.reboundNoBump = false;
          resetActorTransient(ent, { keepFly: true });
          ent.y = 0;
          enforceGroundSeparation();
          if (!mini) applyActorTransform(ent, now);
          else syncTower(ent, now);
          reclaimStageVram();
          return;
        }
        const k = max(0.5, min(2.5, (now - prev) / 16.6667));
        prev = now;
        vy += (mini ? 0.46 : 0.44) * k;
        const drag = Math.pow(mini ? 0.985 : 0.988, k);
        vx *= drag;
        vy *= drag;

        let mainMinX = 8;
        let mainMaxX = 40;
        if (mini) {
          const { minX, maxX } = stageBoundsX();
          const hw = entHalfW(ent);
          let cx = getEntWorldCx(ent) + vx * k;
          if (cx < minX + hw) { cx = minX + hw; vx = -0.45 * vx; }
          else if (cx > maxX - hw) { cx = maxX - hw; vx = -0.45 * vx; }
          setEntWorldCx(ent, cx);
          ent.y = max(-180, (ent.y || 0) + vy * k);
        } else {
          ent.x += vx * k;
          ent.y += vy * k;
          mainMinX = 8;
          mainMaxX = maxXFor(readStageWidth());
          if (hasReboundTarget) {
            const targetX = clamp(bopts.reboundTargetX, mainMinX, mainMaxX);
            if ((vx >= 0 && ent.x > targetX) || (vx < 0 && ent.x < targetX)) {
              ent.x = targetX;
              vx = 0;
            }
          }
          if (ent.x < mainMinX) { ent.x = mainMinX; vx = -0.45 * vx; }
          else if (ent.x > mainMaxX) { ent.x = mainMaxX; vx = -0.45 * vx; }
          if (ent.y < -180) { ent.y = -180; vy = -0.45 * vy; }
        }
        ent.vx = vx;
        ent.vy = vy;

        if (!bopts.noSnap && vy >= 0 && trySnapOntoTower(ent, now)) return;

        if (!mini && !bopts.reboundNoBump) {
          for (const other of activeMainActors()) {
            if (other === ent) continue;
            if (
              !other.reboundNoBump &&
              !other.dragging && !other.stackedOn && !ent.stackedOn &&
              abs(ent.x - other.x) < 42 && abs(ent.y - other.y) < 22 &&
              ((ent.x < other.x && vx > 0.35) || (ent.x >= other.x && vx < -0.35)) &&
              canTriggerPair('ballistic', now, 650)
            ) {
              const sign = ent.x < other.x ? -1 : 1;
              ent.x = clampActorX(other.x + sign * 42);
              const incomingVx = vx;
              vx = -incomingVx * 0.46;
              if (abs(vx) < 1.6) vx = sign * 1.8;
              ent.sym = 'sweat';
              ent.symUntil = now + 750;
              startClip(other, 'wow', 800, { sym: 'bang', face: sign < 0 ? 'left' : 'right' });
              startEntityBallistic(other, clamp(incomingVx * 0.62 || -sign * 2.6, -7.2, 7.2), -2.7);
              recordInteraction('ballisticBump', `${ent.id}->${other.id}`, now);
              renderAllFrames(now);
              break;
            }
          }
        }

        if (ent.y >= 0) {
          ent.y = 0;
          if (!mini && !scattered) { scattered = true; scatterCrabsNear(ent.x + 48); }
          const maxB = mini ? 1 : 2;
          const minVy = mini ? 2.6 : 2.4;
          if (abs(vy) > minVy && bounces < maxB) {
            vy = -vy * (mini ? 0.32 : 0.36);
            vx *= mini ? 0.78 : 0.82;
            bounces += 1;
            // 中途弹跳：ballisticActive 保持 true 锁死 data-direct
            if (!mini) playSeq(ent, [['flat', 1, 2, 0]]);
          } else {
            const impact = abs(vy);
            if (hasReboundTarget) {
              ent.x = clamp(bopts.reboundTargetX, mainMinX, mainMaxX);
            }
            if (!mini) ent.reboundNoBump = false;
            resetActorTransient(ent, { keepFly: true });
            if (!mini) {
              const steps = landingSteps(impact > 1.2 || bounces > 0 ? 2 : 1);
              playSeq(ent, steps);
              if (ent.throws >= 3) {
                ent.throws = 0;
                startClip(ent, 'angry', 1400 + seqTotalMs(steps), { sym: 'vein' });
              }
            }
            enforceGroundSeparation();
            if (!mini) applyActorTransform(ent, now);
            else syncTower(ent, now);
            renderAllFrames(now);
            return;
          }
        }
        ent.rot = clamp(-vx * 0.65, -14, 14);
        ent.vx = vx;
        ent.vy = vy;
        syncAllStackedFollowers();
        if (mini) {
          syncTower(ent, now);
        } else {
          applyActorTransform(ent, now);
          // 仅在姿态真正切变（如起跳进 dangle 或触地切 flat）时重绘精灵，避免 60fps 软件重绘
          if (resolvePoseFor(ent, now) !== ent.lastRender.poseKey) {
            renderAllFrames(now);
          }
        }
        rAF(step);
      };
      rAF(step);
    };

    const startEntityBallistic = (ent, vx0, vy0, bopts = {}) => {
      if (!ent) return;
      const mini = isMiniEnt(ent);
      if (!mini && Math.hypot(vx0, vy0) > 2.2) dismountRidersSideHop(ent.id);
      if (reducedMotion) {
        resetActorTransient(ent, { keepPose: !mini && ent.overridePose !== 'dangle' });
        if (!mini && typeof bopts.reboundTargetX === 'number' && isFin(bopts.reboundTargetX)) {
          ent.x = clampActorX(bopts.reboundTargetX);
        }
        if (bopts.noSnap || !trySnapOntoTower(ent, nowMs())) {
          ent.y = 0;
          enforceGroundSeparation();
          if (!mini) applyActorTransform(ent);
          else syncTower(ent);
          renderAllFrames();
        }
        return;
      }
      if (!mini && bopts.anticipate && ent.y === 0 && !ent.stackedOn) {
        const prepId = (ent.flying += 1);
        ent.ballisticActive = false;
        playSeq(ent, [['squash', 2, 2, -1]]);
        later(TICK * 2, () => {
          if (ent.flying === prepId && !ent.dragging) launchEntity(ent, vx0, vy0, bopts);
        });
        return;
      }
      launchEntity(ent, vx0, vy0, bopts);
    };
    const startBallistic = startEntityBallistic;
    const startMiniBallistic = startEntityBallistic;

    const dragReleaseHooks = [];
    let dragRafPending = false;
    let dragRafId = 0;
    const cAF =
      (win && isFn(win.cancelAnimationFrame) && win.cancelAnimationFrame.bind(win)) ||
      (typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : null);
    const scheduleDragRender = () => {
      if (dragRafPending || disposed) return;
      dragRafPending = true;
      dragRafId = rAF((frameNow) => {
        dragRafId = 0;
        dragRafPending = false;
        if (!disposed) renderAllFrames(frameNow);
      });
    };

    // ── 投喂彩蛋（右键=甜甜圈 / Alt+左键=热咖啡）：立即消气清 pokeCount 并解除 sulk ──
    const feedActor = (actor, item = 'donut') => {
      if (!actor || isMiniEnt(actor) || disposed) return false;
      const now = nowMs();
      markActivity();
      actor.pokeCount = 0;
      actor.lastPokeAt = 0;
      if (actor.overridePose === 'sulk' || actor.overridePose === 'angry') {
        resetActorTransient(actor);
      }
      const pose = item === 'coffee' ? 'feedCoffee' : 'feedDonut';
      startClip(actor, pose, 2200, { sym: 'heart' });
      recordInteraction(pose, actor.id, now);
      renderAllFrames(now);
      return true;
    };

    // 统一主宠 + 迷你蟹指针拖拽绑定（主宠附带右键甜甜圈 & Alt+左键热咖啡投喂）
    const bindEntityPointer = (ent) => {
      const mini = isMiniEnt(ent);
      const domNode = mini ? ent.canvas : ent.el;
      const dragThreshold = mini ? 2.5 : 7;
      let downX = 0;
      let downY = 0;
      let startX = 0;
      let startY = 0;
      let cachedA = 720;
      let cachedB = 680;
      let lastMoveX = 0;
      let lastMoveY = 0;
      let lastMoveT = 0;
      let moved = false;
      let petTimer = 0;
      let petTriggered = false;

      const onDown = (evt) => {
        if (yieldMode === 'peek' || evt.button !== 0 || (mini && !miniPileEnabled)) return;
        evt.preventDefault();
        evt.stopPropagation();
        if (!mini && evt.altKey) {
          feedActor(ent, 'coffee');
          return;
        }
        try { ent.el.setPointerCapture?.(evt.pointerId); } catch {}
        const downNow = nowMs();
        if (ent.glideUntil && downNow < ent.glideUntil) {
          ent.glideSeq = (ent.glideSeq || 0) + 1;
          ent.glideUntil = 0;
          try {
            const er = ent.el?.getBoundingClientRect?.();
            const hr = hostEl?.getBoundingClientRect?.();
            const hasRect =
              er &&
              hr &&
              isFin(er.left) &&
              isFin(hr.left) &&
              ((isFin(er.width) && er.width > 0) || (isFin(er.right) && er.right > er.left));
            if (hasRect) {
              if (mini) setEntWorldCx(ent, er.left - hr.left + 20);
              else ent.x = clampActorX(er.left - hr.left);
            }
          } catch {}
          if (mini) {
            if (ent.el?.style) ent.el.style.transition = '';
          } else {
            for (const cid of getTowerMembers(ent.id)) {
              const member = getEnt(cid);
              if (!member) continue;
              member.glideSeq = (member.glideSeq || 0) + 1;
              member.glideUntil = 0;
              if (member.el?.style) member.el.style.transition = '';
            }
            syncTower(ent);
          }
        }
        if (!mini) ent.reboundNoBump = false;
        if (mini) {
          const { minX, maxX } = stageBoundsX();
          const hw = entHalfW(ent);
          cachedA = minX + hw;
          cachedB = maxX - hw;
          startX = getEntWorldCx(ent);
        } else {
          cachedA = readStageWidth();
          startX = ent.x;
        }
        downX = evt.clientX;
        downY = evt.clientY;
        startY = ent.stackedOn ? computeWorldFootY(ent) : ent.y || 0;
        lastMoveX = evt.clientX;
        lastMoveY = evt.clientY;
        lastMoveT = downNow;
        moved = false;
        petTriggered = false;
        markActivity();
        resetActorTransient(ent);

        if (!mini) {
          clearTimeout(petTimer);
          petTimer = setTimeout(() => {
            if (!moved && !disposed) {
              petTriggered = true;
              startClip(ent, 'pet', 1100, { sym: 'heart' });
              renderAllFrames();
            }
          }, 360);
        }
      };

      const onMove = (evt) => {
        if (lastMoveT === 0) return;
        const dxTotal = evt.clientX - downX;
        const dyTotal = evt.clientY - downY;
        let justStarted = false;
        if (!moved && Math.hypot(dxTotal, dyTotal) > dragThreshold) {
          moved = true;
          justStarted = true;
          clearTimeout(petTimer);
          detachWithGravitySettle(ent.id);
          if (!mini) {
            ent.sideEdgeSnap = false;
            ent.sidePushOriginX = null;
            ent.sideEdgeDirectUntil = 0;
          }
          ent.ballisticActive = false;
          ent.dragging = true;
          syncDirectMotionDomAttr(ent, domNode);
          syncMascotDragRootAttr();
        }
        if (!moved) return;
        evt.stopPropagation?.();
        const now = nowMs();
        const dt = max(4, now - lastMoveT);
        ent.vx = ent.vx * 0.4 + (((evt.clientX - lastMoveX) / dt) * 16) * 0.6;
        ent.vy = ent.vy * 0.4 + (((evt.clientY - lastMoveY) / dt) * 16) * 0.6;
        ent.rot = clamp(-ent.vx * 0.7, -14, 14);
        lastMoveX = evt.clientX;
        lastMoveY = evt.clientY;
        lastMoveT = now;

        const nextY = clamp(startY + dyTotal, -180, 0);
        if (mini) {
          const clampedCx = clamp(startX + dxTotal, cachedA, cachedB);
          const nextPx = max(2, clampedCx - 32);
          ent.px = nextPx;
          ent.lastX = round(nextPx);
          ent.y = nextY;
          const tx = snapCoord(nextPx, true);
          const ty = snapCoord(nextY, true);
          applyMiniTransform(ent, tx, ty, '39', ent.rot);
        } else {
          const rightReserve = popoverRightWidth > 0 ? min(cachedA - 150, popoverRightWidth + 16) : 0;
          ent.x = max(4, min(max(24, cachedA - 88 - rightReserve), startX + dxTotal));
          ent.y = nextY;
          applyActorTransform(ent, now);
        }

        if (justStarted) renderAllFrames(now);
        else scheduleDragRender();

        if (!mini && !reducedMotion && ent.dragging && ent.y > -22) {
          for (const other of activeMainActors()) {
            if (other === ent) continue;
            if (!other.dragging && !other.stackedOn && other.y === 0 && abs(ent.x - other.x) < 38) {
              if (abs(ent.vx) >= 2.0 && canTriggerPair('dragBump', now, 750)) {
                const pushDir = ent.vx >= 0 ? 1 : -1;
                startClip(other, 'wow', 750, { sym: 'bang', face: pushDir > 0 ? 'left' : 'right' });
                startEntityBallistic(other, pushDir * min(5.2, abs(ent.vx) * 0.58), -2.5);
                recordInteraction('dragBump', `${ent.id}->${other.id}`, now);
                scheduleDragRender();
                break;
              } else if (abs(ent.vx) < 2.0 && canTriggerPair('dragPass', now, 1400)) {
                gaze(other, ent.x < other.x ? 'left' : 'right', 750, false, 'note');
                hop(other, 'wave');
                recordInteraction('dragPass', `${ent.id}->${other.id}`, now);
                scheduleDragRender();
                break;
              }
            }
          }
          if (miniPileEnabled && ent.y > -16 && abs(ent.vx) > 1.4 && canTriggerPair('dragCrab', now, 800)) {
            if (miniCrabs.some((mc) => !mc.act && !mc.stackedOn && abs(crabHostCenter(mc) - (ent.x + 48)) < 32)) {
              scatterCrabsNear(ent.x + 48);
              recordInteraction('crabScatter', ent.id, now);
              scheduleDragRender();
            }
          }
        }
      };

      const onUp = (evt) => {
        if (lastMoveT === 0) return;
        clearTimeout(petTimer);
        ent.el.releasePointerCapture?.(evt.pointerId);
        const prevMoveT = lastMoveT;
        lastMoveT = 0;

        if (moved) {
          ent.dragging = false;
          syncMascotDragRootAttr();
          const pNow = nowMs();
          if (pNow - prevMoveT > 35) { ent.vx = 0; ent.vy = 0; }
          if (Math.hypot(ent.vx, ent.vy) < 4.5 && trySnapOntoTower(ent, pNow)) {
            syncDirectMotionDomAttr(ent, domNode);
            moved = false;
            return;
          }
          if (!mini) {
            const wallNow = Date.now();
            if (wallNow - ent.lastThrowAt > 8000) ent.throws = 0;
            ent.throws += 1;
            ent.lastThrowAt = wallNow;
          }
          const mul = mini ? 0.78 : 0.85;
          startEntityBallistic(ent, ent.vx * mul, ent.vy * mul);
          moved = false;
          return;
        }

        if (mini) {
          ent.bumpUntilTick = tickIdx + 6;
          ent.passHopUntilTick = tickIdx + 4;
          renderAllFrames();
        } else if (!petTriggered) {
          triggerPoke(ent, true);
        }
      };

      const cancelDragOnBlur = () => {
        if (lastMoveT === 0 && !ent.dragging) return;
        clearTimeout(petTimer);
        lastMoveT = 0;
        if (moved || ent.dragging) {
          moved = false;
          ent.dragging = false;
          ent.ballisticActive = false;
          ent.vx = 0;
          ent.vy = 0;
          ent.rot = 0;
          syncMascotDragRootAttr();
          syncDirectMotionDomAttr(ent, domNode);
          if (!disposed) startEntityBallistic(ent, 0, 0, { noSnap: true });
        }
      };
      dragReleaseHooks.push(cancelDragOnBlur);

      const onContextMenu = (evt) => {
        if (mini || yieldMode === 'peek') return;
        evt.preventDefault();
        evt.stopPropagation();
        feedActor(ent, 'donut');
      };

      ent.el.addEventListener('pointerdown', onDown);
      ent.el.addEventListener('pointermove', onMove);
      ent.el.addEventListener('pointerup', onUp);
      ent.el.addEventListener('pointercancel', onUp);
      if (!mini) ent.el.addEventListener('contextmenu', onContextMenu);
      const unbind = () => {
        clearTimeout(petTimer);
        const idx = dragReleaseHooks.indexOf(cancelDragOnBlur);
        if (idx >= 0) dragReleaseHooks.splice(idx, 1);
        if (ent.el) {
          ent.el.removeEventListener('pointerdown', onDown);
          ent.el.removeEventListener('pointermove', onMove);
          ent.el.removeEventListener('pointerup', onUp);
          ent.el.removeEventListener('pointercancel', onUp);
          if (!mini) ent.el.removeEventListener('contextmenu', onContextMenu);
        }
      };
      ent._pointerCleanup = unbind;
      cleanups.push(unbind);
    };

    const unmountActorDom = (actor) => {
      if (!actor) return;
      actor.stackedOn = null;
      for (const e of [...Object.values(actors), ...miniCrabs]) {
        if (e?.stackedOn === actor.id) { e.stackedOn = null; e.y = 0; }
      }
      resetActorTransient(actor);
      actor.dragging = false;
      actor.y = 0;
      if (isFn(actor._pointerCleanup)) {
        const idx = cleanups.indexOf(actor._pointerCleanup);
        if (idx >= 0) cleanups.splice(idx, 1);
        try { actor._pointerCleanup(); } catch {}
        actor._pointerCleanup = null;
      }
      zeroCv(actor.canvas, 1);
      rmNode(actor.el);
      actor._ctx = actor.el = actor.canvas = actor.lastDomX = actor.lastDomY = actor.lastDomZ = null;
      actor.lastDomRot = 0;
      actor.lastDomDirect = actor.lastDomDrag = undefined;
      if (actor.lastRender) { actor.lastRender.poseKey = null; actor.lastRender.cw = actor.lastRender.ch = 0; }
    };

    const syncRosterActors = () => {
      const nextSpecs = buildRosterSpecs(roster);
      const nextIds = nextSpecs.map((s) => s.id);
      const nextSet = new Set(nextIds);
      let domChanged = false;
      for (const oldId of activeIds) {
        if (!nextSet.has(oldId)) {
          const oldActor = actors[oldId];
          if (oldActor) unmountActorDom(oldActor);
          delete actors[oldId];
          domChanged = true;
        }
      }
      for (const sp of nextSpecs) {
        let a = actors[sp.id];
        if (!a) {
          a = createActorState(sp.id, sp.kind, sp.label, sp.phaseTicks, sp.phaseOff);
          actors[sp.id] = a;
        }
        if (!a.el) {
          createActorDom(a, fxCanvas);
          if (vramReclaimed || isVramSleepState()) zeroCv(a.canvas);
          bindEntityPointer(a);
          domChanged = true;
        }
      }
      activeIds = nextIds;
      quadEnabled = roster.d > 0 || roster.w > 0;
      miniPileEnabled = !!roster.minis;
      mascotSpec = encodeMascotSpec(roster);
      syncMascotDragRootAttr();
      return domChanged;
    };

    for (const a of activeMainActors()) bindEntityPointer(a);
    miniCrabs.forEach(bindEntityPointer);

    const hasDozeTransition = (now) =>
      activeMainActors().some((a) => a.overridePose && now < a.overrideUntil);
    const inTrans = () =>
      [...activeMainActors(), ...miniCrabs].some(
        (e) => e.dragging || e.ballisticActive || e.leap || e.y < -0.4 || abs(e.vy) > 0.01
      ) || !!reboundTm;
    const syncPwr = () => {
      if (disposed) return;
      if (isHostDetached() || parked) {
        syncHeartbeat();
        reclaimStageVram();
        return;
      }
      if (isDocHidden() || isHostSleeping()) {
        syncHeartbeat();
        reclaimStageVram();
        return;
      }
      if (!isAttrB()) {
        wb = false;
        if (dozing && !isDocHidden() && !isHostSleeping()) { wakeUp(); return; }
      }
      syncHeartbeat();
      if (!theaterTimer && currentTickMs > 0 && !dozing && !reducedMotion) scheduleTheater();
      if (!isWindowBlurred() && !isHostSleeping() && !isPpOpen()) renderAllFrames();
    };
    const onWBlur = () => {
      if (disposed) return;
      wb = true;
      for (let i = 0; i < dragReleaseHooks.length; i++) dragReleaseHooks[i]();
      syncHeartbeat();
    };
    const onWFocus = () => { wb = false; syncPwr(); };
    if (win && isFn(win.addEventListener)) {
      win.addEventListener('blur', onWBlur);
      win.addEventListener('focus', onWFocus);
      cleanups.push(() => { win.removeEventListener?.('blur', onWBlur); win.removeEventListener?.('focus', onWFocus); });
    }
    const MO0 = win?.MutationObserver || (typeof MutationObserver === 'function' ? MutationObserver : null);
    if (MO0 && doc?.documentElement) {
      try {
        let wasResizingAttr = Boolean(doc.documentElement.getAttribute?.(RESIZE_ATTR) === '1');
        const mo = new MO0((records) => {
          if (disposed) return;
          const nowResizingAttr = Boolean(doc.documentElement.getAttribute?.(RESIZE_ATTR) === '1');
          const resizeEnded = wasResizingAttr && !nowResizingAttr;
          wasResizingAttr = nowResizingAttr;
          if (resizeEnded) onStageResizeReleased();
          const hasPowerMut =
            !Array.isArray(records) ||
            records.some(
              (r) => !r || !r.attributeName || r.attributeName === WB || r.attributeName === PM || r.attributeName === PP_OPEN
            );
          if (hasPowerMut) syncPwr();
        });
        mo.observe(doc.documentElement, { attributes: true, attributeFilter: [WB, PM, PP_OPEN, RESIZE_ATTR] });
        cleanups.push(() => mo.disconnect());
      } catch {}
    }

    // ── 生态联动：活动唤醒 / 打盹 / 领衔交接 / 外部事件 notify ───────────────
    const faceToward = (from, to) => (!from || !to || to.x >= from.x ? 'right' : 'left');

    const onHeartbeat = () => {
      if (disposed) return;
      const now = nowMs();
      if (
        isHostDetached() ||
        parked ||
        isDocHidden() ||
        isHostSleeping() ||
        isPpOpen() ||
        (isWindowBlurred() && (dozing || !inTrans())) ||
        (reducedMotion && !inTrans())
      ) {
        syncHeartbeat(now);
        if (isVramSleepState()) reclaimStageVram();
        return;
      }
      tickIdx += 1;
      updateBalance();
      ecoTick(now);
      renderAllFrames(now);
      syncHeartbeat(now);
    };

    function syncHeartbeat(now = nowMs()) {
      let targetMs = TICK;
      if (
        disposed ||
        isHostDetached() ||
        parked ||
        isDocHidden() ||
        isHostSleeping() ||
        isPpOpen() ||
        (isWindowBlurred() && (dozing || !inTrans())) ||
        (reducedMotion && !inTrans())
      ) {
        targetMs = 0;
      } else if (dozing && !stageBusy() && !hasDozeTransition(now)) {
        targetMs = DOZE_TICK;
      }
      if (targetMs === 0 || dozing || reducedMotion) {
        clearTimeout(theaterTimer);
        theaterTimer = 0;
      } else if (!theaterTimer) {
        scheduleTheater();
      }
      if (isVramSleepState()) reclaimStageVram();
      if (targetMs === currentTickMs) return;
      if (tickTimer !== null) {
        clearInterval(tickTimer);
        tickTimer = null;
      }
      currentTickMs = targetMs;
      if (targetMs > 0) {
        tickTimer = setInterval(onHeartbeat, targetMs);
        if (tickTimer && isFn(tickTimer.unref)) tickTimer.unref();
      }
    }

    function wakeUp() {
      if (!dozing) return;
      dozing = false;
      lastActivityAt = nowMs();
      syncHeartbeat();
      // 伸懒腰醒来（复用 stretch 姿态，各宠错峰 2 拍）
      const mains = activeMainActors();
      mains.forEach((a, i) => {
        const go = () => {
          if (!dozing && actors[a.id] === a) {
            startClip(a, a.kind === 'whale' ? 'whaleSpout' : 'stretch', a.kind === 'whale' ? 1200 : 1100);
          }
        };
        if (!i) go(); else later(TICK * 2 * i, go);
      });
      renderAllFrames();
    }

    function markActivity() {
      if (!isAttrB()) wb = false;
      lastActivityAt = nowMs();
      if (dozing && !isHostSleeping() && !isWindowBlurred()) wakeUp();
      else syncHeartbeat();
    }

    // 进入打盹：先打哈欠（错峰 0.4s），哈欠结束后由 resolvePoseFor 接管为 sleep 并拉宽至 400ms
    function startDoze(skipYawn) {
      if (dozing) return;
      dozing = true;
      for (const a of activeMainActors()) {
        if (a.overridePose && a.overridePose !== 'dangle') a.overrideUntil = 0;
        a.eyeScan = 0;
      }
      if (!skipYawn) {
        const prePose = isLateNight() ? 'nightSip' : 'yawn';
        const preMs = isLateNight() ? 1800 : 1200;
        activeMainActors().forEach((a, idx) => {
          if (!idx) startClip(a, prePose, preMs);
          else later(400 * idx, () => { if (dozing) startClip(a, prePose, preMs); });
        });
      }
      const now = nowMs();
      renderAllFrames(now);
      syncHeartbeat(now);
    }

    const bumpSeq = (p) => [['squash', 1, 2, -1, 0], [p, 2, -1, 1, -2], ['idle', 1, 1, -1, 0]];

    // 每拍生态检查：忙碌视为活动；空闲超时则打盹；检测自主散步遇障（撑跳越过 / 搭便车 / 礼貌转身）与伙伴碰撞
    const ecoTick = (now) => {
      if (stageBusy()) {
        lastActivityAt = now;
        if (dozing) wakeUp();
        return;
      }
      if (!dozing && now - lastActivityAt > (isLateNight() ? DOZE_AFTER_NIGHT_MS : DOZE_AFTER_MS)) {
        startDoze(false);
        return;
      }
      if (reducedMotion || dozing || now < duetUntil) return;

      const mains = activeMainActors();
      const freeG = (e) => !e.dragging && !e.ballisticActive && !e.stackedOn && !e.leap && e.y === 0;
      const isWalk = (a) => resolvePoseFor(a, now) === 'walk' && now < a.overrideUntil;
      for (let i = 0; i < mains.length; i++) {
        const a = mains[i];
        if (!freeG(a)) continue;
        const aW = isWalk(a);
        for (let j = i + 1; j < mains.length; j++) {
          const b = mains[j];
          if (!freeG(b)) continue;
          const enc = classifyPairEncounter({
            xA: a.x, yA: a.y, walkingA: aW, dirA: a.patrolDir,
            xB: b.x, yB: b.y, walkingB: isWalk(b), dirB: b.patrolDir,
            contactDist: 46, verticalTol: 22,
          });
          if (enc?.kind === 'bump' && canTriggerPair(`mainWalk:${a.id}:${b.id}`, now, 1200)) {
            a.x = clampActorX(a.x - enc.sign * 5);
            b.x = clampActorX(b.x + enc.sign * 5);
            a.faceDir = enc.sign > 0 ? 'right' : 'left';
            b.faceDir = enc.sign > 0 ? 'left' : 'right';
            a.sym = 'bang'; b.sym = 'spark';
            a.symUntil = b.symUntil = now + 850;
            a.overridePose = b.overridePose = 'idle';
            a.overrideUntil = b.overrideUntil = now + 440;
            playSeq(a, bumpSeq('wow'));
            playSeq(b, bumpSeq('tilt'));
            later(420, () => {
              if (disposed || stageBusy() || reducedMotion || dozing) return;
              startClip(a, 'walk', 2200, { patrolDir: -enc.sign });
              startClip(b, 'walk', 2200, { patrolDir: enc.sign });
            });
            recordInteraction('bump', `${a.id}-${b.id}`, now);
            return;
          }
          if (enc?.kind === 'passBy' && canTriggerPair(`mainPass:${a.id}:${b.id}`, now, 1500)) {
            triggerObstacleEncounter((enc.mover === 'A' ? a : b).id, (enc.mover === 'A' ? b : a).id);
            return;
          }
        }
      }

      // 场景 4：散步遇障（主宠与自由迷你蟹相遇时触发撑跳越过 / 自动搭便车 / 驻足眨眼转身）
      if (miniPileEnabled) {
        for (const a of mains) {
          if (!freeG(a)) continue;
          const aWalk = isWalk(a);
          for (const mc of miniCrabs) {
            if (!freeG(mc) || mc.act) continue;
            const d = getEntWorldCx(mc) - getEntWorldCx(a);
            if (abs(d) < 40 && canTriggerPair(`obs:${a.id}:${mc.id}`, now, 1600)) {
              if (aWalk && d * a.patrolDir > 0) { triggerObstacleEncounter(a.id, mc.id); return; }
              if (d * mc.dir < 0) { triggerObstacleEncounter(mc.id, a.id); return; }
            }
          }
        }
      }
    };

    // 原地整格小跳（减少动态 / 拖拽 / 叠叠乐 / 腾空时跳过，直接回调）
    const hop = (a, airPose, then) => {
      const now = nowMs();
      const partnerOnTop = Boolean(findDirectRider(a.id));
      if (reducedMotion || !actorFree(a, now) || partnerOnTop) {
        if (then) then();
        return;
      }
      playSeq(a, hopSteps(airPose), then);
    };

    // 扫视：转身 + 竖瞳偏向；up=true 时抬头
    const gaze = (a, dir, ms, up = false, sym = null) => {
      const now = nowMs();
      if (a.dragging || (a.overridePose === 'dangle' && now < a.overrideUntil)) return;
      startClip(a, 'gaze', ms, { face: dir === 'left' ? 'left' : 'right', param: up ? 1 : 0, sym: sym || undefined });
    };

    // 领衔位交接：新阵营下蹲小跳交换站位；落地后新阵营全员冒 spark、旧阵营点头，三蟹迎宾挥手
    const campHandoff = (prevCamp = null) => {
      const now = nowMs();
      if (now - lastHandoffAt < 700) return;
      lastHandoffAt = now;
      duetUntil = now + 1200;
      const workers = workingActors();
      const leader = workers[0] || null;
      if (!leader) {
        crabsWave();
        renderAllFrames();
        return;
      }
      const prevList = prevCamp ? campActors(prevCamp).filter((a) => !workers.includes(a)) : [];
      const old = prevList[0] || partnerActor();
      const hasOld = Boolean(old && old !== leader);
      const finish = () => {
        if (disposed) return;
        for (const w of workers) startClip(w, 'happy', 900, { sym: 'spark' });
        if (hasOld) startClip(old, 'lookNod', 1300, { face: faceToward(old, leader), param: 2 });
        crabsWave();
        renderAllFrames();
      };
      if (reducedMotion) {
        resetHomePositions(false);
        finish();
        return;
      }
      const jumpers = hasOld ? [...workers, old] : [...workers];
      let pending = jumpers.length;
      const done = () => {
        pending -= 1;
        if (pending === 0) finish();
      };
      for (const a of jumpers) hop(a, 'jiggle', done);
      later(TICK * 2, () => resetHomePositions(false));
    };

    const celebrateDone = () => {
      const mains = activeMainActors();
      if (!mains.length) {
        crabsWave();
        return;
      }
      const workers = workingActors();
      const workerSet = new Set(workers);
      const now = nowMs();
      for (const w of workers) {
        w.sym = 'heart';
        w.symUntil = now + 1500;
      }
      if (reducedMotion) {
        mains.forEach((a) =>
          startClip(
            a,
            workerSet.has(a) ? 'happy' : a.kind === 'whale' ? 'whaleSpout' : 'happy',
            900,
            workerSet.has(a) ? { sym: 'heart' } : {}
          )
        );
        return;
      }
      mains.forEach((a) => hop(a, 'jiggle'));
    };

    // ── 9 大 Slash 指令专属微剧场（2.4~2.8s，演完归零 0fps）──────────────────
    let lastVialWarnAt = 0;
    const SLASH_HANDLERS = {
      plan(workers, partners, fP) {
        for (const w of workers) startClip(w, 'slashPlan', 2600);
        for (const p of partners) {
          startClip(p, 'tilt', 1300, { rot: -8, sym: 'q', face: fP(p) });
          later(1350, () => { if (!disposed && actors[p.id] === p) startClip(p, 'lookNod', 1200, { face: fP(p), param: 2 }); });
        }
      },
      goal(workers, partners) {
        for (const w of workers) startClip(w, 'slashGoal', 2600);
        for (const p of partners) startClip(p, 'salute', 2400, { sym: 'spark' });
      },
      boost(workers, partners) {
        for (const w of workers) {
          startClip(w, 'slashBoost', 2600);
          if (!reducedMotion) { spawnChromaBurst(getEntWorldCx(w), computeWorldFootY(w) - 18, 12, false); hop(w, 'slashBoost'); }
        }
        for (const p of partners) startClip(p, 'wow', 2200, { sym: 'spark' });
      },
      teamwork(workers, partners) {
        for (const w of workers) startClip(w, 'slashTeam', 2800);
        for (const p of partners) startClip(p, 'salute', 2600, { sym: 'spark' });
        if (miniPileEnabled) {
          const mid = round(readStageWidth() * 0.45);
          miniCrabs.forEach((mc, idx) => {
            if (mc.act?.type === 'ride') return;
            const x0 = crabSafeX(mc.lastX), tx = crabSafeX(mid + (idx - 1) * 28);
            mc.act = {
              type: 'wave', start: tickIdx + 1,
              segs: [
                { ticks: 6, x0, x1: tx, y0: 0, y1: 0, sprite: 'walk' },
                { ticks: 14, x0: tx, x1: tx, y0: 0, y1: 0, sprite: 'wave', hop: true },
                { ticks: 6, x0: tx, x1: x0, y0: 0, y1: 0, sprite: 'walk' },
              ],
            };
          });
        }
      },
      browser(workers, partners) {
        for (const w of workers) {
          const startX = w.x, dir = startX > readStageWidth() * 0.5 ? -1 : 1;
          startClip(w, 'slashBrowser', 2600, { mirror: dir < 0 });
          if (!reducedMotion && !w.stackedOn && !w.dragging) {
            w.x = clampActorX(startX + dir * 28);
            later(2200, () => { if (!disposed && actors[w.id] === w && !w.dragging && !w.stackedOn) resetHomePositions(true); });
          }
        }
        for (const p of partners) startClip(p, 'wow', 2200, { sym: 'spark' });
      },
      compact() {
        for (const a of activeMainActors()) startClip(a, 'slashCompact', 2800, a.kind === 'cat' || a.kind === 'whale' ? { mirror: true } : {});
      },
      schedule(workers, partners, fP) {
        scheduleWatchUntil = Date.now() + 18e5;
        renderHabitatProp(true);
        for (const w of workers) startClip(w, 'slashSchedule', 2600);
        for (const p of partners) startClip(p, 'lookNod', 2200, { face: fP(p), param: 3 });
      },
      'grill-me'(workers, partners, fP) {
        for (const w of workers) startClip(w, 'slashGrill', 2600);
        for (const p of partners) startClip(p, 'lookNod', 2400, { face: fP(p), param: 4 });
      },
      learn() {
        for (const a of activeMainActors()) startClip(a, a.kind === 'cat' || a.kind === 'dragon' ? 'slashLearnBook' : 'slashLearnBulb', 2600);
      },
    };
    const runSlashTheater = (rawCmd) => {
      const cmd = String(rawCmd || '').replace(/^\/+/, '').trim().toLowerCase();
      const norm = cmd === 'swarm' ? 'teamwork' : cmd;
      const fn = cmd && !disposed && hasOwn(SLASH_HANDLERS, norm) ? SLASH_HANDLERS[norm] : null;
      if (!fn) return false;
      const now = nowMs();
      const workers = workingActors();
      const leader = workers[0] || null;
      const partners = activeMainActors().filter((a) => !workers.includes(a));
      duetUntil = now + 2900;
      fn(workers, partners, (p) => faceToward(p, leader));
      recordInteraction('slash:' + norm, leader ? leader.id : 'minis', now);
      return true;
    };

    // 外部事件处理表（未知事件静默忽略）
    const NOTIFY = {
      activity() {},
      'slash-cmd'(p) {
        if (!runSlashTheater(p?.cmd)) NOTIFY.send();
      },
      'effort-tier'(p) {
        const tier = String(p?.tier || '').toLowerCase();
        if (tier === 'high' || tier === 'xhigh') {
          const workers = workingActors();
          if (!workers.length) return;
          for (const w of workers) {
            startClip(w, 'slashBoost', 2200, { sym: 'spark' });
            if (!reducedMotion) spawnChromaBurst(getEntWorldCx(w), computeWorldFootY(w) - 16, 6, true);
          }
          recordInteraction('effort-tier:' + tier, workers[0].id, nowMs());
        }
      },
      'vial-high'() {
        const wallNow = Date.now();
        if (wallNow - lastVialWarnAt < 600000) return;
        const mains = activeMainActors();
        if (!mains.length) return;
        lastVialWarnAt = wallNow;
        const leftPet = mains.reduce((best, cur) => (cur.x < best.x ? cur : best), mains[0]);
        if (leftPet.dragging || leftPet.stackedOn) return;
        const origX = leftPet.x;
        if (!reducedMotion) leftPet.x = clampActorX(16);
        startClip(leftPet, 'worry', 2200, { face: 'left', mirror: true, sym: 'sweat' });
        recordInteraction('vial-high', leftPet.id, nowMs());
        later(2300, () => {
          if (!disposed && actors[leftPet.id] === leftPet && !leftPet.dragging && !leftPet.stackedOn) {
            leftPet.x = clampActorX(origX);
            resetHomePositions(true);
            renderAllFrames();
          }
        });
      },
      'aura-complete'() {
        const now = nowMs();
        const mains = activeMainActors();
        if (!mains.length) {
          crabsWave();
          recordInteraction('aura-complete', 'minis', now);
          return;
        }
        duetUntil = now + 2200;
        const cat = mains.find((a) => a.kind === 'cat');
        const clawd = mains.find((a) => a.kind === 'clawd');
        for (const a of mains) {
          if (a.kind === 'dragon') startClip(a, 'dragonFlame', 2000, { sym: 'spark' });
          else if (a.kind === 'whale') startClip(a, 'whaleSpout', 2000, { sym: 'heart' });
          else if (a.kind === 'cat') startClip(a, 'happy', 2000, { face: clawd ? faceToward(a, clawd) : 'left', sym: 'spark' });
          else startClip(a, 'happy', 2000, { face: cat ? faceToward(a, cat) : 'right', sym: 'heart' });
        }
        if (!reducedMotion) {
          mains.forEach((a) => hop(a, 'happy'));
        }
        recordInteraction('aura-complete', mains.length > 2 ? 'multi' : 'clawd-cat', now);
      },
      campSwitch() {
        // 与 setState 自动触发 700ms 内去重，避免主代理双路调用时重复交接
        campHandoff();
      },
      'model-shift'() {
        chromaGates.tuned = true;
        for (const w of workingActors()) gaze(w, 'left', 800, true, 'spark');
      },
      'vial-opened'() {
        chromaGates.tuned = true;
        activeMainActors().forEach((a) => gaze(a, 'left', 820, false, 'spark'));
      },
      'code-copied'() {
        chromaGates.forged = true;
        const now = nowMs();
        for (const w of workingActors()) {
          w.nodY = PX;
          w.nodUntil = now + 180;
          w.sym = 'note';
          w.symUntil = now + 850;
        }
      },
      'files-changed'() {
        chromaGates.forged = true;
        for (const w of workingActors()) startClip(w, 'salute', 780, { sym: 'spark' });
      },
      complete() {
        chromaGates.forged = true;
        celebrateDone();
      },
      orchestrator(p) {
        orchestrator = !!p.on;
        if (orchestrator) {
          activeMainActors().forEach((a) => gaze(a, 'left', 900, true, 'spark'));
        }
      },
      streamDone(p) {
        if (p.error) {
          activeMainActors().forEach((a) => startClip(a, 'worry', 1500, { sym: 'sweat' }));
          return;
        }
        chromaGates.forged = true;
        celebrateDone();
      },
      ripple(p) {
        const x = Number(p.x);
        if (!isFin(x)) return;
        for (const a of activeMainActors()) {
          const dir = x < a.x + 48 ? 'left' : 'right';
          gaze(a, dir, 700);
          if (a.kind === 'cat' || a.kind === 'dragon') {
            a.forceTwitchStart = tickIdx;
            a.forceTwitchSide = dir === 'left' ? 'L' : 'R';
          }
        }
      },
      send() {
        const workers = workingActors();
        const leader = workers[0] || null;
        if (!leader) {
          crabsWave();
          return;
        }
        for (const w of workers) startClip(w, 'salute', 900, { sym: 'spark' });
        for (const p of activeMainActors()) {
          if (!workers.includes(p)) startClip(p, 'lookNod', 1200, { face: faceToward(p, leader), param: 2 });
        }
      },
      'host-sleep'(p) {
        hostSleep = !!(p?.sleep);
        syncHeartbeat();
        if (hostSleep || isVramSleepState()) {
          reclaimStageVram();
        } else if (!isWindowBlurred()) {
          renderAllFrames();
        }
      },
    };
    const handleNotify = (event, payload) => {
      if (disposed) return;
      const fn = hasOwn(NOTIFY, event) ? NOTIFY[event] : null;
      if (!fn) return;
      const pl = payload && typeof payload === 'object' ? payload : {};
      if (event === 'host-sleep') {
        fn(pl);
        return;
      }
      const wasDozing = dozing;
      markActivity();
      if (event === 'activity') {
        if (wasDozing) renderAllFrames();
        return;
      }
      fn(pl);
      renderAllFrames();
    };

    // 鼠标靠近舞台或切回可见标签页时，0ms 恢复 100ms 灵敏心跳
    const onApproach = () => {
      markActivity();
    };
    if (isFn(hostEl.addEventListener)) {
      hostEl.addEventListener('pointerenter', onApproach, { passive: true });
      hostEl.addEventListener('pointermove', onApproach, { passive: true });
      cleanups.push(() => {
        hostEl.removeEventListener('pointerenter', onApproach);
        hostEl.removeEventListener('pointermove', onApproach);
      });
    }
    const onVisibilityChange = () => {
      if (disposed) return;
      syncHeartbeat();
      if (isVramSleepState()) {
        reclaimStageVram();
      } else if (!isWindowBlurred()) {
        renderAllFrames();
      }
    };
    if (doc && isFn(doc.addEventListener)) {
      doc.addEventListener('visibilitychange', onVisibilityChange);
      cleanups.push(() => {
        doc.removeEventListener('visibilitychange', onVisibilityChange);
      });
    }

    const mountOntoStack = (riderId, holderId) => {
      const rider = getEnt(riderId);
      const holder = getEnt(holderId);
      if (!rider || !holder || rider.id === holder.id) return false;
      if (!miniPileEnabled && (isMiniEnt(rider) || isMiniEnt(holder))) return false;
      const top = getStackTop(holder.id);
      if (!top || getTowerMembers(top.id).includes(rider.id)) return false;
      const riderSubLen = getTowerMembers(rider.id).length;
      const baseLen = getTowerMembers(top.id).length;
      if (baseLen + riderSubLen > maxTowerDepthAllowed()) return false;
      if (rider.stackedOn) {
        detachWithGravitySettle(rider.id);
      }
      rider.flying += 1;
      rider.ballisticActive = false;
      rider.leap = null;
      if (isMiniEnt(rider)) rider.act = null;
      rider.stackedOn = top.id;
      rider.y = 0;
      rider.vx = 0;
      rider.vy = 0;
      rider.rot = 0;
      rider.perchUntil = 0;
      if (!isMiniEnt(rider)) {
        rider.seq = null;
        startClip(rider, 'happy', 900, { sym: 'heart' });
      }
      syncAllStackedFollowers();
      renderAllFrames();
      return true;
    };

    const syncPeekInteractivity = () => {
      const isPeek = yieldMode === 'peek';
      if (hostEl) {
        if (isPeek) hostEl.setAttribute?.('data-ag-mascot-peek', '1');
        else hostEl.removeAttribute?.('data-ag-mascot-peek');
      }
      if (isPeek) {
        dragReleaseHooks.forEach((fn) => { try { fn(); } catch {} });
      }
      for (const a of activeMainActors()) {
        if (!a?.el) continue;
        a.el.setAttribute?.('tabindex', '-1');
        if (isPeek) a.el.setAttribute?.('aria-hidden', 'true');
        else a.el.removeAttribute?.('aria-hidden');
        if (a.el.style) a.el.style.pointerEvents = isPeek ? 'none' : '';
        applyActorTransform(a, nowMs());
      }
      if (miniGroupEl?.style) miniGroupEl.style.pointerEvents = isPeek ? 'none' : '';
      for (const mc of miniCrabs) {
        if (!mc?.el) continue;
        if (mc.el.style) mc.el.style.pointerEvents = isPeek ? 'none' : 'auto';
        const mz = miniZ(mc);
        if (mc.lastDomZ !== mz) {
          mc.lastDomZ = mz;
          if (mc.el.style) mc.el.style.zIndex = mz;
        }
      }
    };

    syncPeekInteractivity();
    renderAllFrames();
    syncHeartbeat();

    return {
      setState(next = {}) {
        const prev = [popoverRightWidth, camp, streaming, streamTier, hasError, yieldMode, leapOffsetY, miniPileEnabled, quadEnabled, orchestrator, reducedMotion, mascotSpec];
        if (next.camp !== undefined) camp = normalizeCamp(next.camp);
        if (next.streaming !== undefined) streaming = !!next.streaming;
        if (next.streamTier !== undefined) streamTier = Number(next.streamTier || 2);
        if (next.hasError !== undefined) hasError = !!next.hasError;
        if (next.yieldMode !== undefined) yieldMode = next.yieldMode || 'none';
        if (next.leapOffsetY !== undefined) leapOffsetY = Number(next.leapOffsetY || 0);
        if (next.popoverRightWidth !== undefined) popoverRightWidth = Number(next.popoverRightWidth || 0);
        if (next.orchestrator !== undefined) orchestrator = !!next.orchestrator;
        if (next.reducedMotion !== undefined) {
          reducedMotion = !!next.reducedMotion;
          if (reducedMotion && !prev[10]) freezeMotion();
          else if (!reducedMotion && prev[10]) lastActivityAt = nowMs();
        }

        let nextRoster = { ...roster };
        let rosterFromSpec = false;
        if (next.mascot !== undefined) {
          const parsed = parseMascotSpec(next.mascot);
          if (parsed) {
            nextRoster = parsed;
            rosterFromSpec = true;
          }
        }
        if (!rosterFromSpec) {
          if (next.quadEnabled !== undefined) {
            const q = !!next.quadEnabled;
            if (q) {
              if (nextRoster.c === 0 && nextRoster.k === 0 && nextRoster.d === 0 && nextRoster.w === 0) {
                nextRoster.c = 1;
                nextRoster.k = 1;
              }
              nextRoster.d = 1;
              nextRoster.w = 1;
            } else {
              nextRoster.d = 0;
              nextRoster.w = 0;
              if (nextRoster.c === 0 && nextRoster.k === 0) {
                nextRoster.c = 1;
                nextRoster.k = 1;
              }
            }
          }
          if (next.miniPileEnabled !== undefined) nextRoster.minis = !!next.miniPileEnabled;
        }
        const nextMascotSpec = encodeMascotSpec(nextRoster);
        const nextQuad = nextRoster.d > 0 || nextRoster.w > 0;
        const nextMinis = !!nextRoster.minis;
        roster = nextRoster;
        mascotSpec = nextMascotSpec;
        quadEnabled = nextQuad;
        miniPileEnabled = nextMinis;

        const cur = [popoverRightWidth, camp, streaming, streamTier, hasError, yieldMode, leapOffsetY, miniPileEnabled, quadEnabled, orchestrator, reducedMotion, mascotSpec];
        if (cur.every((v, i) => v === prev[i])) return;

        if (mascotSpec !== prev[11] || quadEnabled !== prev[8]) {
          const domChanged = syncRosterActors();
          if (domChanged) {
            resetHomePositions(false);
            syncPeekInteractivity();
          }
        }
        if (camp !== prev[1]) {
          // 挂载后阵营实际变化：自动播放领衔交接（站位交换在其内部完成）
          markActivity();
          campHandoff(prev[1]);
          if (nowMs() - lastHandoffAt > 50) resetHomePositions(popoverRightWidth !== prev[0]);
        } else if (popoverRightWidth !== prev[0] || miniPileEnabled !== prev[7]) {
          resetHomePositions(popoverRightWidth !== prev[0]);
        }
        if (yieldMode !== prev[5] || leapOffsetY !== prev[6]) syncPeekInteractivity();
        if (reducedMotion !== prev[10] || streaming !== prev[2]) syncHeartbeat();
        renderAllFrames();
      },
      notify(event, payload = {}) {
        handleNotify(event, payload);
      },
      stackOnto(riderId, holderId) {
        return mountOntoStack(riderId, holderId);
      },
      pullFromStack(id, mode = 'settle') {
        const ent = getEnt(id);
        if (!ent) return false;
        if (mode === 'sideHop') {
          return dismountRidersSideHop(ent.id);
        }
        const origCx = getEntWorldCx(ent);
        detachWithGravitySettle(ent.id);
        resetActorTransient(ent);
        ent.y = 0;
        setEntWorldCx(ent, origCx - 64);
        enforceGroundSeparation();
        renderAllFrames();
        return true;
      },
      triggerObstacle(moverId, obstacleId, forcedAction = null) {
        return triggerObstacleEncounter(moverId, obstacleId, forcedAction);
      },
      triggerDemo(kind) {
        const now = nowMs(), leader = leaderActor(), partner = partnerActor();
        inspectState = null;
        const stageObs = (mode) => {
          if (!leader || !partner || leader === partner) return;
          partner.stackedOn = leader.stackedOn = null;
          partner.y = leader.y = 0;
          const mid = round((clampActorX(9999) + 16) * 0.48);
          partner.x = clampActorX(mid);
          leader.x = clampActorX(mid - 50);
          triggerObstacleEncounter(leader.id, partner.id, mode);
        };
        const DEMO = {
          doze: () => startDoze(true),
          wake: markActivity,
          theater: () => { markActivity(); runDuet(pickDuet()); },
          campSwitch: () => {
            markActivity();
            const prevC = camp;
            const presentCamps = ['claude', 'gemini', 'gpt', 'deepseek'].filter((c) => campActors(c).length > 0);
            const order = presentCamps.length >= 2 ? presentCamps : quadEnabled ? ['claude', 'gemini', 'gpt', 'deepseek'] : ['claude', 'gemini'];
            camp = order[(order.indexOf(camp) + 1) % order.length];
            lastHandoffAt = 0;
            campHandoff(prevC);
          },
          streamDone: () => { markActivity(); NOTIFY.streamDone({ error: false }); },
          crabRide: () => { markActivity(); miniPileEnabled = true; roster.minis = true; mascotSpec = encodeMascotSpec(roster); resetHomePositions(false); runCrabRide(true); },
          bump: () => {
            markActivity();
            const mains = activeMainActors();
            const c = actors.clawd || mains[0];
            const k = (actors.cat && actors.cat !== c ? actors.cat : mains.find((a) => a !== c)) || null;
            if (!c || !k) return;
            const mid = round((clampActorX(9999) + 16) * 0.46);
            c.stackedOn = k.stackedOn = null; c.y = k.y = 0;
            c.x = clampActorX(mid - 20); k.x = clampActorX(mid + 20);
            c.sym = 'bang'; k.sym = 'spark'; c.symUntil = k.symUntil = now + 900;
            playSeq(c, bumpSeq('wow')); playSeq(k, bumpSeq('tilt'));
            recordInteraction('bump', `${c.id}-${k.id}`, now);
          },
          passBy: () => { markActivity(); stageObs('leapfrog'); },
          leapfrog: () => stageObs('leapfrog'),
          autoPerch: () => stageObs('autoPerch'),
          greetTurn: () => stageObs('greetTurn'),
          stack: () => {
            if (partner && leader && partner !== leader) mountOntoStack(partner.id, leader.id);
            else if (miniPileEnabled && miniCrabs.length >= 2) mountOntoStack(miniCrabs[1].id, miniCrabs[0].id);
          },
          unstack: () => {
            for (const e of allActiveEnts()) { e.stackedOn = null; e.perchUntil = 0; resetActorTransient(e); e.y = 0; }
            resetHomePositions(true);
          },
          toss: () => {
            if (!leader) return;
            dismountRidersSideHop(leader.id);
            if (leader.stackedOn) detachWithGravitySettle(leader.id);
            leader.y = -48;
            startBallistic(leader, -3.5, -7.8);
          },
          poke: () => { if (leader) triggerPoke(leader, false); },
          feedDonut: () => { if (leader) feedActor(leader, 'donut'); },
          feedCoffee: () => { if (leader) feedActor(leader, 'coffee'); },
          vialHigh: () => { lastVialWarnAt = 0; NOTIFY['vial-high']({}); },
          auraComplete: () => NOTIFY['aura-complete']({}),
          effortHigh: () => NOTIFY['effort-tier']({ tier: 'xhigh' }),
        };
        if (hasOwn(DEMO, kind)) DEMO[kind]();
        else if (typeof kind === 'string' && /^(?:slash:|\/)/.test(kind)) { markActivity(); runSlashTheater(kind.replace(/^(?:slash:|\/)/, '')); }
        else if (leader) {
          const mapped = { fire: 'onFire', cheer: 'cheerSticks', rickroll: 'rickroll', siren: 'siren' }[kind] || kind;
          if (['onFire', 'siren', 'spinHop'].includes(mapped)) dismountRidersSideHop(leader.id);
          startClip(leader, mapped, 3800);
          if (partner && partner !== leader && ['onFire', 'cheerSticks', 'rickroll', 'siren'].includes(mapped)) {
            startClip(partner, mapped === 'cheerSticks' ? 'cheerSticks' : 'wow', 3600, { sym: mapped === 'siren' ? 'sweat' : 'spark' });
          }
        }
        renderAllFrames(now);
      },
      inspectPose(opts = null) {
        if (!opts || opts.active === false) {
          inspectState = null;
          syncHeartbeat();
          renderAllFrames();
          return null;
        }
        inspectState = {
          pose: opts.pose || 'idle',
          tick: isFin(opts.tick) ? max(0, floor(opts.tick)) : tickIdx,
          mirror: !!opts.mirror,
          sqW: round(Number(opts.sqW || 0)),
          sqH: round(Number(opts.sqH || 0)),
          ruler: !!opts.ruler,
          sym: opts.sym || null,
        };
        tickIdx = inspectState.tick;
        renderAllFrames();
        return { ...inspectState };
      },
      stepTick(delta = 1) {
        const d = round(Number(delta || 1));
        tickIdx = max(0, tickIdx + d);
        if (inspectState) inspectState.tick = tickIdx;
        renderAllFrames();
        return tickIdx;
      },
      listPoses() {
        return ALL_POSE_KEYS.slice();
      },
      poke(id = 'cat') {
        const target = actors[id] || activeMainActors()[0] || null;
        if (target) triggerPoke(target, false);
      },
      feed(id = 'cat', item = 'donut') {
        const target = actors[id] || activeMainActors()[0] || null;
        return target ? feedActor(target, item) : false;
      },
      setHabitatPreview(mode = 'auto') {
        habitatPreview = ['auto', 'cactus', 'lamp', 'hourglass'].includes(mode) ? mode : 'auto';
        renderHabitatProp(true);
        return resolveHabitatMode();
      },
      onUserType(text = '') {
        const now = nowMs();
        markActivity();
        const workers = workingActors();
        if (!workers.length) return;
        const trimmed = String(text || '').replace(/\s+$/, '');
        if (/[?？]$/.test(trimmed)) {
          for (const w of workers) startClip(w, 'tilt', 750, { rot: -9, sym: 'q' });
        } else if (/[!！]$/.test(trimmed)) {
          for (const w of workers) startClip(w, 'wow', 700, { sym: 'bang' });
        } else {
          for (const w of workers) {
            w.nodY = PX; // 打字点头：整格下沉 1 格
            w.nodUntil = now + 140;
            w.eyeScan = 0;
          }
          clearTimeout(pauseTimer);
          pauseTimer = setTimeout(() => {
            if (disposed) return;
            for (const w of workingActors()) w.eyeScan = tickIdx % 2 ? -1 : 1;
            renderAllFrames();
            later(500, () => {
              for (const w of activeMainActors()) w.eyeScan = 0;
            });
          }, 450);
        }
        renderAllFrames(now);
      },
      setRimLight(n = null) {
        if (disposed) return;
        const on = Boolean(n?.active && Number(n.strength) > 0.015);
        const x = on ? Number(n.localX) || 0 : -9999;
        const s = on ? max(0, min(1, Number(n.strength) || 0)) : 0;
        const t = on && RIM_PALS[n.toneKey] ? n.toneKey : 'default';
        const d = on ? n.dark !== false : true;
        const sig = on ? `1|${round(x / 6)}|${round(s * 12)}|${t}|${d ? 1 : 0}` : '0';
        if (sig === rimSig) return;
        rimSig = sig;
        rim.on = on;
        rim.x = x;
        rim.s = s;
        rim.t = t;
        rim.d = d;
        if (!isVramSleepState() && !isWindowBlurred() && !isPpOpen()) renderAllFrames();
      },
      getLayoutSnapshot() {
        const now = nowMs();
        return {
          camp,
          mascot: mascotSpec,
          roster: { ...roster },
          miniPileEnabled,
          quadEnabled,
          reducedMotion,
          // 生态联动与按需渲染遥测只读诊断
          dozing,
          orchestrator,
          rimLight: { active: rim.on, strength: round(rim.s * 100) / 100, toneKey: rim.t },
          habitat: {
            mode: resolveHabitatMode(),
            scheduleActive: Date.now() < scheduleWatchUntil,
          },
          towers: listAllTowers(),
          chromaResonance: {
            active: prismaticCoat,
            tuned: chromaGates.tuned,
            forged: chromaGates.forged,
            sparkCount: chromaSparks.length,
          },
          perf: {
            timerIntervalMs: currentTickMs,
            timerPaused: isHostDetached() || parked || isWindowBlurred() || isHostSleeping() || currentTickMs === 0,
            vramReclaimed,
            canvasDraws: perfStats.canvasDraws,
            canvasSkips: perfStats.canvasSkips,
            domTransformWrites: perfStats.domTransformWrites,
            domTransformSkips: perfStats.domTransformSkips,
          },
          lastInteraction: { ...lastInteraction },
          minis: miniCrabs.map((mc) => ({
            id: mc.id,
            act: mc.act && tickIdx >= mc.act.start ? mc.act.type : null,
            x: round(mc.lastX),
            y: round(mc.stackedOn ? computeWorldFootY(mc) : mc.y || 0),
            worldCx: round(getEntWorldCx(mc)),
            dir: mc.dir,
            stackedOn: mc.stackedOn,
            leap: !!mc.leap,
          })),
          actors: activeMainIds().map((id) => {
            const a = actors[id];
            const rect = a.el ? a.el.getBoundingClientRect() : null;
            const fx = a.lastFx || {};
            return {
              id,
              x: a.x,
              y: a.y,
              footY: round(computeWorldFootY(a)),
              worldCx: round(getEntWorldCx(a)),
              pose: resolvePoseFor(a, now),
              sym: a.sym && now < a.symUntil ? a.sym : null,
              rot: effectiveRot(a, now),
              pokeCount: a.pokeCount,
              stackedOn: a.stackedOn,
              leap: !!a.leap,
              rect: rect ? { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom } : null,
              // 附加诊断字段（只读）：整数格挤压量、待机微动作与静止帧缓存快照
              squash: a.lastSq ? { ...a.lastSq } : { w: 0, h: 0 },
              blinkStage: fx.blinkStage || null,
              breath: !!fx.breath,
              earTwitch: fx.earTwitch || null,
              clawSnap: fx.clawSnap || null,
              glance: fx.glance || 0,
              tick: tickIdx,
              renderCache: {
                poseKey: a.lastRender.poseKey,
                frameIdx: a.lastRender.frameIdx,
                flip: a.lastRender.flip,
                tintState: a.lastRender.tintState,
                lastX: a.lastDomX,
                lastY: a.lastDomY,
                lastRot: a.lastRender.lastRot,
              },
            };
          }),
        };
      },
      park(on = true) {
        if (disposed) return;
        parked = !!on;
        syncHeartbeat();
        if (parked) {
          reclaimStageVram();
        } else if (!isVramSleepState() && !isWindowBlurred()) {
          renderAllFrames();
        }
      },
      resume() {
        if (disposed) return;
        parked = false;
        syncHeartbeat();
        if (!isVramSleepState() && !isWindowBlurred() && !isPpOpen()) renderAllFrames();
      },
      syncPowerState: syncPwr,
      dispose() {
        disposed = true;
        rim.on = false;
        rim.s = 0;
        rimSig = '0';
        const liveMains = activeMainActors();
        for (const e of [...liveMains, ...miniCrabs]) {
          if (e) { e.dragging = e.ballisticActive = false; e.rot = 0; }
        }
        syncMascotDragRootAttr();
        if (tickTimer !== null) { clearInterval(tickTimer); tickTimer = null; }
        currentTickMs = 0;
        if (dragRafId && cAF) { try { cAF(dragRafId); } catch {} dragRafId = 0; }
        dragRafPending = false;
        if (resizeRaf && cAF) { try { cAF(resizeRaf); } catch {} resizeRaf = 0; }
        clearTimeout(pauseTimer);
        clearTimeout(theaterTimer);
        pendingTimers.forEach((t) => clearTimeout(t));
        pendingTimers.clear();
        try {
          if (reducedMq?.removeEventListener) reducedMq.removeEventListener('change', onReducedChange);
          else if (reducedMq?.removeListener) reducedMq.removeListener(onReducedChange);
        } catch {}
        pairCooldowns.clear();
        try {
          reclaimStageVram();
          zeroCv(fxCanvas, 1);
          zeroCv(habitatCanvas, 1);
          for (const e of [...liveMains, ...miniCrabs]) {
            if (e) { e._ctx = null; zeroCv(e.canvas, 1); }
          }
        } catch {}
        cleanups.forEach((fn) => fn());
        for (const n of [miniGroupEl, ...liveMains.map((a) => a.el), fxCanvas, habitatCanvas]) rmNode(n);
      },
    };
  }

  const mascotArt = {
    source: 'ch10-rig',
    PALETTES,
    MINI_SPRITES,
    MINI_ANIM_FRAMES,
    PROPS,
    SYMS,
    buildClipLayers,
    drawLayerSet,
    drawMainActor(ctx, kind, poseKey, tickIdx, oxGrid, oyGrid, pxSize, opts = {}) {
      if (!ctx) return 0;
      const pal = PALETTES[kind] || PALETTES.clawd;
      const layers = buildClipLayers(kind, poseKey, tickIdx, opts);
      drawLayerSet(ctx, oxGrid, oyGrid, pxSize, pal, layers);
      return layers.length;
    },
    drawMiniCrab(ctx, id, frameKey, oxGrid, oyGrid, pxSize) {
      if (!ctx) return 0;
      const pal = PALETTES[id] || PALETTES.cowboy;
      const spr = frameKey && MINI_ANIM_FRAMES[id]?.[frameKey] ? MINI_ANIM_FRAMES[id][frameKey] : MINI_SPRITES[id];
      if (!spr) return 0;
      drawLayerSet(ctx, oxGrid, oyGrid, pxSize, pal, [spr]);
      return 1;
    },
  };

  return {
    PX,
    TICK,
    DOZE_TICK,
    OFFICIAL_OPEN_REF,
    PALETTES,
    CLAWD_PARTS,
    CAT_PARTS,
    DRAGON_PARTS,
    WHALE_PARTS,
    MINI_SPRITES,
    MINI_ANIM_FRAMES,
    PROPS,
    SYMS,
    mascotArt,
    MASCOT_SPECIES_ORDER,
    MASCOT_MAX_PER_SPECIES,
    MASCOT_MAX_TOTAL,
    parseMascotSpec,
    encodeMascotSpec,
    normalizeMascotValue,
    isValidMascotValue,
    resolveClawdStandGrid,
    drawLayerSet,
    renderPixelLayers,
    buildClipLayers,
    classifyPairEncounter,
    stepMiniCrabCorridor,
    evalChromaColorAt,
    resolveGroundSeparation,
    chooseObstacleAction,
    mountDualMascotStage,
  };
});

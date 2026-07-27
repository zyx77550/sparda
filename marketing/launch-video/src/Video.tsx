import React from 'react';
import {
  AbsoluteFill,
  Audio,
  Img,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { brand, verdict, font, shadow } from './theme';
import { copy, Lang } from './copy';

// ---------- timeline (30fps) ----------
// The kinetic word-punch intro REPLACES the old static hook (retention cold-open,
// CapCut-style but native: brand type, sound-synced, no watermark).
const T = {
  intro: 0, // word punches
  code: 168, // code card pops (5.6s)
  edit: 386, // guard line struck
  gate: 538, // BLOCKED slams
  prove: 726, // terminal
  outro: 986,
  end: 1166, // ~38.9s
};
const INTRO_BEATS = [0, 32, 64, 100, 134]; // word start frames (accelerating rhythm)

// ---------- shared bits ----------

const ease = (f: number, a: number, b: number, from = 0, to = 1) =>
  interpolate(f, [a, b], [from, to], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

const Background: React.FC = () => {
  const frame = useCurrentFrame();
  const drift = frame * 0.18;
  // deterministic network
  const nodes = React.useMemo(() => {
    let s = 42;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    return new Array(26).fill(0).map(() => ({
      x: rnd() * 1080,
      y: rnd() * 1920,
      r: 3 + rnd() * 5,
      c: rnd(),
    }));
  }, []);
  const edges = React.useMemo(() => {
    const out: Array<[number, number]> = [];
    for (let i = 0; i < nodes.length; i++)
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = nodes[i].x - nodes[j].x;
        const dy = nodes[i].y - nodes[j].y;
        if (Math.hypot(dx, dy) < 340) out.push([i, j]);
      }
    return out;
  }, [nodes]);
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(120% 90% at 50% 12%, ${brand.bgTop} 0%, ${brand.bgBottom} 100%)`,
      }}
    >
      <svg
        width="1080"
        height="1920"
        style={{ position: 'absolute', opacity: 0.55 }}
      >
        <g transform={`translate(${-drift * 0.4}, ${-drift * 0.25})`}>
          {edges.map(([i, j], k) => (
            <line
              key={k}
              x1={nodes[i].x}
              y1={nodes[i].y}
              x2={nodes[j].x}
              y2={nodes[j].y}
              stroke={brand.net}
              strokeWidth={1.4}
            />
          ))}
          {nodes.map((n, k) => (
            <circle
              key={k}
              cx={n.x}
              cy={n.y}
              r={n.r}
              fill={
                n.c > 0.86 ? brand.cyan : n.c > 0.7 ? brand.blue : brand.net
              }
              opacity={n.c > 0.7 ? 0.8 : 1}
            />
          ))}
        </g>
      </svg>
    </AbsoluteFill>
  );
};

const Progress: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        height: 8,
        width: `${(frame / durationInFrames) * 100}%`,
        background: `linear-gradient(90deg, ${brand.purpleDeep}, ${brand.purpleLight})`,
        borderRadius: 4,
        zIndex: 50,
      }}
    />
  );
};

const Caption: React.FC<{
  text: string;
  appear: number;
  accent?: string[];
  bottom?: number;
}> = ({ text, appear, accent = [], bottom = 200 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - appear, fps, config: { damping: 14 } });
  const lines = text.split('\n');
  return (
    <div
      style={{
        position: 'absolute',
        bottom,
        width: '100%',
        textAlign: 'center',
        transform: `translateY(${(1 - s) * 60}px)`,
        opacity: s,
        padding: '0 70px',
        zIndex: 20,
      }}
    >
      {lines.map((line, i) => (
        <div
          key={i}
          style={{
            fontFamily: font.sans,
            fontWeight: 700,
            fontSize: 74,
            lineHeight: 1.16,
            color: brand.ink,
            letterSpacing: '-0.02em',
          }}
        >
          {line.split(' ').map((w, j) => (
            <span
              key={j}
              style={{
                color: accent.some((a) =>
                  w.toLowerCase().includes(a.toLowerCase()),
                )
                  ? brand.purple
                  : brand.ink,
              }}
            >
              {w}{' '}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
};

// ---------- scene 0: kinetic word-punch intro ----------

const KineticIntro: React.FC<{ lang: Lang }> = ({ lang }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const words = copy[lang].intro;
  // which beat are we on?
  let idx = 0;
  for (let i = 0; i < INTRO_BEATS.length; i++)
    if (frame >= INTRO_BEATS[i]) idx = i;
  const word = words[idx];
  const local = frame - INTRO_BEATS[idx];
  const punch = spring({
    frame: local,
    fps,
    config: { damping: 14, stiffness: 320, mass: 0.7 },
  });
  const scale = 1.24 - punch * 0.24;
  const introLen = T.code;
  const out = ease(frame, introLen - 10, introLen, 1, 0);
  // the final word inverts the screen: full purple, white type
  const inverted = word.invert;
  return (
    <AbsoluteFill style={{ opacity: out }}>
      {inverted && (
        <AbsoluteFill
          style={{
            background: `linear-gradient(135deg, ${brand.purpleDeep}, ${brand.purple})`,
            transform: `scale(${Math.min(1, 0.2 + punch * 0.8) * 1.6})`,
            borderRadius: punch < 1 ? 999 : 0,
          }}
        />
      )}
      <AbsoluteFill
        style={{ justifyContent: 'center', alignItems: 'center' }}
      >
        <div
          style={{
            fontFamily: font.sans,
            fontWeight: 700,
            fontSize: word.text.length > 12 ? 108 : 150,
            letterSpacing: '-0.02em',
            textAlign: 'center',
            padding: '0 40px',
            lineHeight: 1.05,
            color: inverted
              ? '#FFFFFF'
              : word.accent
                ? brand.purple
                : brand.ink,
            transform: `scale(${scale})`,
            opacity: Math.min(1, punch * 2),
          }}
        >
          {word.text}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ---------- scene 1+2: AI types code ----------

const CODE_LINES = [
  { t: `// routes/users.ts`, c: '#9A97B8' },
  { t: `app.delete('/api/users/:id',`, c: brand.ink },
  { t: `  requireRole('admin'),`, c: brand.purple, guard: true },
  { t: `  async (req, res) => {`, c: brand.ink },
  { t: `    await db.user.delete({`, c: brand.ink },
  { t: `      where: { id: req.params.id }`, c: brand.ink },
  { t: `    });`, c: brand.ink },
  { t: `    res.status(204).end();`, c: brand.ink },
  { t: `  }`, c: brand.ink },
  { t: `);`, c: brand.ink },
];
const totalChars = CODE_LINES.reduce((a, l) => a + l.t.length + 1, 0);

const CodeScene: React.FC<{ lang: Lang }> = ({ lang }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const c = copy[lang];

  // card pop
  const cardS = spring({
    frame: frame - T.code,
    fps,
    config: { damping: 12, mass: 0.9 },
  });

  // typing progress
  const typed = Math.floor(
    ease(frame, T.code + 16, T.edit - 42, 0, totalChars),
  );

  // edit moment: strike the guard line (gentle push-in that keeps the card in frame)
  const strike = ease(frame, T.edit, T.edit + 24);
  const editZoom = ease(frame, T.edit - 30, T.edit + 30, 1, 1.1);
  const editShiftY = ease(frame, T.edit - 30, T.edit + 30, 0, 40);

  // scene exits before gate
  const sceneOut = ease(frame, T.gate - 12, T.gate, 1, 0.94);
  const sceneFade = ease(frame, T.gate - 10, T.gate, 1, 0);

  let consumed = 0;
  return (
    <AbsoluteFill style={{ opacity: sceneFade }}>
      {/* editor card */}
      <div
        style={{
          position: 'absolute',
          top: 430,
          left: 60,
          right: 60,
          transform: `scale(${cardS * sceneOut * editZoom}) translateY(${-editShiftY}px)`,
          transformOrigin: '50% 42%',
          opacity: cardS,
          background: brand.card,
          borderRadius: 28,
          border: `1px solid ${brand.cardBorder}`,
          boxShadow: shadow.card,
          overflow: 'hidden',
        }}
      >
        {/* title bar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '26px 32px',
            borderBottom: `1px solid ${brand.cardBorder}`,
          }}
        >
          {['#FF5F57', '#FEBC2E', '#28C840'].map((cc) => (
            <div
              key={cc}
              style={{
                width: 18,
                height: 18,
                borderRadius: 9,
                background: cc,
              }}
            />
          ))}
          <div
            style={{
              marginLeft: 16,
              fontFamily: font.mono,
              fontSize: 26,
              color: brand.inkSoft,
            }}
          >
            agent — routes/users.ts
          </div>
          {/* AI edit chip appears at strike */}
          <div
            style={{
              marginLeft: 'auto',
              opacity: strike,
              transform: `scale(${0.8 + strike * 0.2})`,
              fontFamily: font.mono,
              fontSize: 24,
              fontWeight: 700,
              color: '#FFFFFF',
              background: `linear-gradient(90deg, ${brand.purpleDeep}, ${brand.purpleLight})`,
              padding: '10px 22px',
              borderRadius: 999,
            }}
          >
            AI edit
          </div>
        </div>
        {/* code */}
        <div style={{ padding: '30px 36px 40px' }}>
          {CODE_LINES.map((line, i) => {
            const start = consumed;
            consumed += line.t.length + 1;
            const visible = Math.max(
              0,
              Math.min(line.t.length, typed - start),
            );
            const text = line.t.slice(0, visible);
            const isGuard = 'guard' in line && line.guard;
            const cursorHere =
              typed >= start && typed < start + line.t.length + 1;
            return (
              <div
                key={i}
                style={{
                  fontFamily: font.mono,
                  fontSize: 33,
                  lineHeight: 1.75,
                  whiteSpace: 'pre',
                  color: line.c,
                  position: 'relative',
                  background:
                    isGuard && strike > 0
                      ? `rgba(224, 93, 68, ${0.12 * strike})`
                      : undefined,
                  borderRadius: 8,
                  textDecoration:
                    isGuard && strike > 0.5 ? 'line-through' : undefined,
                  textDecorationColor: verdict.notProven,
                  textDecorationThickness: 4,
                  opacity: isGuard ? 1 - strike * 0.35 : 1,
                }}
              >
                {isGuard && strike > 0 && (
                  <span
                    style={{
                      position: 'absolute',
                      left: -26,
                      color: verdict.notProven,
                      fontWeight: 700,
                      opacity: strike,
                    }}
                  >
                    −
                  </span>
                )}
                {text}
                {cursorHere && frame % 16 < 9 && (
                  <span
                    style={{
                      display: 'inline-block',
                      width: 18,
                      height: 40,
                      background: brand.purple,
                      verticalAlign: 'middle',
                      marginLeft: 2,
                      borderRadius: 3,
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* caption at strike */}
      {frame >= T.edit + 10 && (
        <Caption
          appear={T.edit + 10}
          text={c.editCaption}
          accent={[
            lang === 'fr' ? 'supprimer' : 'removed',
            lang === 'fr' ? "d'authentification." : 'guard.',
          ]}
          bottom={230}
        />
      )}
    </AbsoluteFill>
  );
};

// ---------- scene 3: the gate blocks ----------

const GateScene: React.FC<{ lang: Lang }> = ({ lang }) => {
  // NOTE: rendered inside <Sequence from={T.gate}> — frame is already local.
  const local = useCurrentFrame();
  const { fps } = useVideoConfig();
  const c = copy[lang];
  const slam = spring({
    frame: local,
    fps,
    config: { damping: 11, mass: 1.1, stiffness: 180 },
  });
  // screen shake on impact
  const shakeAmp = Math.max(0, 1 - local / 12);
  const shakeX = Math.sin(local * 2.4) * 14 * shakeAmp;
  const shakeY = Math.cos(local * 3.1) * 9 * shakeAmp;
  const gateLen = T.prove - T.gate;
  const fadeOut = ease(local, gateLen - 12, gateLen, 1, 0);

  return (
    <AbsoluteFill
      style={{
        opacity: fadeOut,
        transform: `translate(${shakeX}px, ${shakeY}px)`,
      }}
    >
      {/* red wash */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(90% 60% at 50% 45%, rgba(224,93,68,${
            0.1 * slam * fadeOut
          }) 0%, rgba(224,93,68,0) 70%)`,
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: 560,
          left: 70,
          right: 70,
          transform: `scale(${0.8 + slam * 0.2})`,
          opacity: slam,
          background: brand.card,
          border: `3px solid ${verdict.notProven}`,
          borderRadius: 32,
          boxShadow: shadow.danger,
          padding: '54px 54px 50px',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 26,
          }}
        >
          <div
            style={{
              width: 92,
              height: 92,
              borderRadius: 26,
              background: verdict.notProven,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              fontSize: 52,
              fontWeight: 800,
              fontFamily: font.sans,
            }}
          >
            ✕
          </div>
          <div>
            <div
              style={{
                fontFamily: font.mono,
                fontSize: 30,
                color: brand.inkSoft,
                marginBottom: 6,
              }}
            >
              sparda gate
            </div>
            <div
              style={{
                fontFamily: font.sans,
                fontWeight: 800,
                fontSize: 76,
                color: verdict.notProven,
                letterSpacing: '-0.01em',
                lineHeight: 1,
              }}
            >
              {c.gateTitle}
            </div>
          </div>
        </div>
        <div
          style={{
            marginTop: 34,
            fontFamily: font.mono,
            fontSize: 32,
            color: brand.ink,
            background: '#FBF1EF',
            border: `1px solid rgba(224,93,68,0.35)`,
            borderRadius: 14,
            padding: '20px 26px',
          }}
        >
          − requireRole('admin')
        </div>
        <div
          style={{
            marginTop: 22,
            fontFamily: font.body,
            fontSize: 33,
            color: brand.inkSoft,
          }}
        >
          {c.gateSub}
        </div>
      </div>
      <Caption
        appear={22}
        text={c.gateCaption}
        accent={['SPARDA', 'bloque.', 'blocks']}
        bottom={300}
      />
    </AbsoluteFill>
  );
};

// ---------- scene 4: the proof terminal ----------

const TERM_LINES = [
  { t: '◇ compiling behavior graph…  579 routes', d: 26 },
  { t: '✓ guards verified            512 proven', d: 44 },
  { t: '✓ invariants hold            0 broken', d: 58 },
  { t: '✓ no unguarded mutation', d: 72 },
];

const ProveScene: React.FC<{ lang: Lang }> = ({ lang }) => {
  // NOTE: rendered inside <Sequence from={T.prove}> — frame is already local.
  const local = useCurrentFrame();
  const { fps } = useVideoConfig();
  const c = copy[lang];
  const cardS = spring({ frame: local, fps, config: { damping: 12 } });
  const cmd = c.cmd;
  const cmdTyped = Math.floor(ease(local, 10, 44, 0, cmd.length));
  const linesStart = 52;
  const verdictAt = 150;
  const vS = spring({
    frame: local - verdictAt,
    fps,
    config: { damping: 10, stiffness: 160 },
  });
  const proveLen = T.outro - T.prove;
  const fadeOut = ease(local, proveLen - 12, proveLen, 1, 0);

  return (
    <AbsoluteFill style={{ opacity: fadeOut }}>
      <div
        style={{
          position: 'absolute',
          top: 470,
          left: 60,
          right: 60,
          opacity: cardS,
          transform: `scale(${0.94 + cardS * 0.06})`,
          background: '#0E0C1E',
          borderRadius: 28,
          boxShadow: shadow.pop,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '24px 30px',
            borderBottom: '1px solid rgba(255,255,255,0.08)',
          }}
        >
          {['#FF5F57', '#FEBC2E', '#28C840'].map((cc) => (
            <div
              key={cc}
              style={{ width: 18, height: 18, borderRadius: 9, background: cc }}
            />
          ))}
          <div
            style={{
              marginLeft: 16,
              fontFamily: font.mono,
              fontSize: 25,
              color: 'rgba(255,255,255,0.55)',
            }}
          >
            zsh — sparda
          </div>
        </div>
        <div style={{ padding: '34px 38px 44px' }}>
          <div
            style={{
              fontFamily: font.mono,
              fontSize: 34,
              color: '#EDEAFF',
              whiteSpace: 'pre',
            }}
          >
            <span style={{ color: brand.cyan }}>$ </span>
            {cmd.slice(0, cmdTyped)}
            {local < linesStart && local % 16 < 9 && (
              <span
                style={{
                  display: 'inline-block',
                  width: 18,
                  height: 40,
                  background: '#EDEAFF',
                  verticalAlign: 'middle',
                  marginLeft: 2,
                  borderRadius: 3,
                }}
              />
            )}
          </div>
          <div style={{ height: 18 }} />
          {TERM_LINES.map((l, i) => {
            const on = local >= linesStart + l.d;
            const isCheck = l.t.startsWith('✓');
            return (
              <div
                key={i}
                style={{
                  fontFamily: font.mono,
                  fontSize: 31,
                  lineHeight: 1.9,
                  whiteSpace: 'pre',
                  opacity: on ? 1 : 0,
                  color: isCheck ? '#B9F6C2' : 'rgba(237,234,255,0.75)',
                }}
              >
                {l.t}
              </div>
            );
          })}

          {/* verdict chip */}
          <div
            style={{
              marginTop: 30,
              display: 'flex',
              alignItems: 'center',
              gap: 24,
              opacity: Math.min(1, vS * 1.2),
              transform: `scale(${0.8 + vS * 0.2})`,
              transformOrigin: '0% 50%',
            }}
          >
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 16,
                background: verdict.proven,
                color: '#fff',
                borderRadius: 999,
                padding: '18px 40px',
                fontFamily: font.sans,
                fontWeight: 800,
                fontSize: 46,
                letterSpacing: '0.02em',
                boxShadow: '0 12px 44px rgba(68,204,17,0.45)',
              }}
            >
              ✓ {c.provenChip}
            </div>
            <div
              style={{
                fontFamily: font.mono,
                fontSize: 27,
                color: 'rgba(237,234,255,0.8)',
              }}
            >
              {c.provenMeta}
            </div>
          </div>
        </div>
      </div>
      <Caption
        appear={26}
        text={c.proveCaption}
        accent={['prouve', 'proves']}
        bottom={260}
      />
    </AbsoluteFill>
  );
};

// ---------- scene 5: outro ----------

const OutroScene: React.FC<{ lang: Lang }> = ({ lang }) => {
  // NOTE: rendered inside <Sequence from={T.outro}> — frame is already local.
  const local = useCurrentFrame();
  const { fps } = useVideoConfig();
  const c = copy[lang];
  const sIn = spring({
    frame: local,
    fps,
    config: { damping: 12, mass: 1 },
  });
  const wmIn = spring({ frame: local - 14, fps, config: { damping: 13 } });
  const signIn = spring({ frame: local - 30, fps, config: { damping: 13 } });
  const cmdIn = spring({ frame: local - 48, fps, config: { damping: 13 } });

  return (
    <AbsoluteFill>
      <div
        style={{
          position: 'absolute',
          top: 430,
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        <Img
          src={staticFile('s-logo.png')}
          style={{
            width: 300,
            transform: `scale(${sIn})`,
            filter: 'drop-shadow(0 30px 70px rgba(72,16,224,0.30))',
          }}
        />
        <Img
          src={staticFile('wordmark.png')}
          style={{
            width: 620,
            marginTop: 70,
            opacity: wmIn,
            transform: `translateY(${(1 - wmIn) * 40}px)`,
          }}
        />
        <div
          style={{
            marginTop: 30,
            fontFamily: font.sans,
            fontWeight: 600,
            fontSize: 30,
            letterSpacing: '0.34em',
            color: brand.inkSoft,
            opacity: wmIn,
          }}
        >
          {lang === 'fr' ? (
            <>
              RUNTIME AU COMPORTEMENT{' '}
              <span style={{ color: brand.purple }}>DÉTERMINISTE</span>
            </>
          ) : (
            <>
              DETERMINISTIC BEHAVIOR{' '}
              <span style={{ color: brand.purple }}>RUNTIME</span>
            </>
          )}
        </div>

        <div
          style={{
            marginTop: 110,
            textAlign: 'center',
            opacity: signIn,
            transform: `translateY(${(1 - signIn) * 40}px)`,
          }}
        >
          <div
            style={{
              fontFamily: font.sans,
              fontWeight: 700,
              fontSize: 64,
              color: brand.ink,
              letterSpacing: '-0.02em',
            }}
          >
            {lang === 'fr' ? (
              <>
                L'IA écrit. <span style={{ color: brand.purple }}>SPARDA</span>{' '}
                prouve.
              </>
            ) : (
              <>
                AI writes. <span style={{ color: brand.purple }}>SPARDA</span>{' '}
                proves.
              </>
            )}
          </div>
          <div
            style={{
              marginTop: 16,
              fontFamily: font.body,
              fontWeight: 500,
              fontSize: 36,
              color: brand.inkSoft,
            }}
          >
            {lang === 'fr' ? c.outroSign1 : c.outroSign2}
          </div>
        </div>

        <div
          style={{
            marginTop: 96,
            opacity: cmdIn,
            transform: `scale(${0.9 + cmdIn * 0.1})`,
            fontFamily: font.mono,
            fontSize: 40,
            color: '#fff',
            background: `linear-gradient(90deg, ${brand.purpleDeep}, ${brand.purpleLight})`,
            padding: '26px 54px',
            borderRadius: 999,
            boxShadow: '0 20px 60px rgba(72,16,224,0.35)',
          }}
        >
          {c.cmd}
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ---------- sound design ----------

// Voiceover cue points (frames). Segments generated by gen-voice.py (Kokoro TTS,
// Apache-2.0 — FR ff_siwis, EN af_heart) into public/vo/<lang>-<name>.wav.
const VO_CUES: Array<{ name: string; at: number }> = [
  { name: 'intro', at: 2 },
  { name: 'code', at: T.code + 20 },
  { name: 'strike', at: T.edit - 4 },
  { name: 'gate', at: T.gate + 14 },
  { name: 'prove', at: T.prove + 20 },
  { name: 'outro', at: T.outro + 16 },
];

const Sound: React.FC<{ lang: Lang }> = ({ lang }) => (
  <>
    {/* voiceover */}
    {VO_CUES.map((v) => (
      <Sequence key={`vo-${v.name}`} from={v.at}>
        <Audio src={staticFile(`vo/${lang}-${v.name}.wav`)} volume={1} />
      </Sequence>
    ))}
    {/* one tick per intro word; the inverted final word lands with the block thud */}
    {INTRO_BEATS.map((b, i) => (
      <Sequence key={`intro-${i}`} from={b}>
        <Audio
          src={staticFile(i === INTRO_BEATS.length - 1 ? 'block.wav' : 'return.wav')}
          volume={i === INTRO_BEATS.length - 1 ? 0.6 : 0.4}
        />
      </Sequence>
    ))}
    <Sequence from={T.code - 8}>
      <Audio src={staticFile('whoosh.wav')} volume={0.5} />
    </Sequence>
    <Sequence from={T.code - 4}>
      <Audio src={staticFile('pop.wav')} volume={0.7} />
    </Sequence>
    <Sequence from={T.code + 16}>
      <Audio src={staticFile('typing.wav')} volume={0.3} />
    </Sequence>
    <Sequence from={T.gate - 66}>
      <Audio src={staticFile('riser.wav')} volume={0.8} />
    </Sequence>
    <Sequence from={T.gate}>
      <Audio src={staticFile('block.wav')} volume={1} />
    </Sequence>
    <Sequence from={T.prove - 2}>
      <Audio src={staticFile('pop.wav')} volume={0.6} />
    </Sequence>
    <Sequence from={T.prove + 10}>
      <Audio src={staticFile('typing.wav')} volume={0.3} endAt={40} />
    </Sequence>
    <Sequence from={T.prove + 46}>
      <Audio src={staticFile('return.wav')} volume={0.8} />
    </Sequence>
    <Sequence from={T.prove + 150}>
      <Audio src={staticFile('ding.wav')} volume={0.85} />
    </Sequence>
    <Sequence from={T.outro - 8}>
      <Audio src={staticFile('whoosh.wav')} volume={0.6} />
    </Sequence>
    <Sequence from={T.outro + 30}>
      <Audio src={staticFile('ding.wav')} volume={0.35} />
    </Sequence>
  </>
);

// ---------- main ----------

export const SpardaVideo: React.FC<{ lang: Lang }> = ({ lang }) => {
  return (
    <AbsoluteFill>
      <Background />
      <Progress />
      <Sequence from={0} durationInFrames={T.code}>
        <KineticIntro lang={lang} />
      </Sequence>
      <Sequence from={0} durationInFrames={T.gate}>
        <CodeScene lang={lang} />
      </Sequence>
      <Sequence from={T.gate} durationInFrames={T.prove - T.gate}>
        <GateScene lang={lang} />
      </Sequence>
      <Sequence from={T.prove} durationInFrames={T.outro - T.prove}>
        <ProveScene lang={lang} />
      </Sequence>
      <Sequence from={T.outro}>
        <OutroScene lang={lang} />
      </Sequence>
      <Sound lang={lang} />
    </AbsoluteFill>
  );
};

export { T };

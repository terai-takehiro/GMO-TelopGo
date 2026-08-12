/**
 * 系統(チャンネル)の移行ロジック (純関数・electron非依存でテスト可能)
 *
 * 旧 name/side を汎用TL枠 (tl1/tl2) へ張り替える。
 */

/** 旧チャンネルID → 汎用TL枠 */
const CH_REMAP = { name: 'tl1', side: 'tl2' };
/** TL枠の旧既定ラベル (これらのみ TL1/TL2 へ張替。ユーザー独自ラベルは保持) */
const LEGACY_LABELS = { tl1: ['名前', 'name', 'TL1'], tl2: ['サイド', 'side', 'TL2'] };

/**
 * 系統リストを汎用TL枠へ正規化する。
 *   - id/region: name→tl1, side→tl2
 *   - ラベル: tl1/tl2 で旧既定ラベル (名前/サイド 等) のときのみ TL1/TL2 へ。独自ラベルは保持
 * @returns {{ channels: Array, changed: boolean }}
 */
function migrateChannelList(channels) {
  let changed = false;
  const out = (channels || []).map((c) => {
    const to = CH_REMAP[c.region] || CH_REMAP[c.id] || c.region || c.id;
    let label = c.label;
    if ((to === 'tl1' || to === 'tl2') && LEGACY_LABELS[to].includes(c.label)) {
      label = to === 'tl1' ? 'TL1' : 'TL2';
    }
    if (to !== (c.region || c.id) || label !== c.label) changed = true;
    return { ...c, id: to, region: to, label };
  });
  return { channels: out, changed };
}

module.exports = { CH_REMAP, LEGACY_LABELS, migrateChannelList };

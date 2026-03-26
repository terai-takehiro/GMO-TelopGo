const Store = require('electron-store');

const store = new Store({
  defaults: {
    outputUrl: '',
    nameTelop: {
      appToken: '',
      shots: {
        nameOnly: {
          subCompositionName: '',
          fields: { nameJp: 'onlynameJp', nameEn: 'onlynameEn' },
        },
        '1S': {
          subCompositionName: '',
          fields: { titleJp: 'titleJp', nameJp: 'nameJp', titleEn: 'titleEn', nameEn: 'nameEn' },
        },
        '2S': {
          subCompositionName: '',
          fields: {
            titleJp: 'titleJp', nameJp: 'nameJp', titleEn: 'titleEn', nameEn: 'nameEn',
            '2ndTitleJp': '2ndTitleJp', '2ndNameJp': '2ndNameJp', '2ndTitleEn': '2ndTitleEn', '2ndNameEn': '2ndNameEn',
          },
        },
        '3S': {
          subCompositionName: '',
          fields: {
            titleJp: 'titleJp', nameJp: 'nameJp', titleEn: 'titleEn', nameEn: 'nameEn',
            '2ndTitleJp': '2ndTitleJp', '2ndNameJp': '2ndNameJp', '2ndTitleEn': '2ndTitleEn', '2ndNameEn': '2ndNameEn',
            '3rdTitleJp': '3rdTitleJp', '3rdNameJp': '3rdNameJp', '3rdTitleEn': '3rdTitleEn', '3rdNameEn': '3rdNameEn',
          },
        },
        '4S': {
          subCompositionName: '',
          fields: {
            titleJp: 'titleJp', nameJp: 'nameJp', titleEn: 'titleEn', nameEn: 'nameEn',
            '2ndTitleJp': '2ndTitleJp', '2ndNameJp': '2ndNameJp', '2ndTitleEn': '2ndTitleEn', '2ndNameEn': '2ndNameEn',
            '3rdTitleJp': '3rdTitleJp', '3rdNameJp': '3rdNameJp', '3rdTitleEn': '3rdTitleEn', '3rdNameEn': '3rdNameEn',
            '4thTitleJp': '4thTitleJp', '4thNameJp': '4thNameJp', '4thTitleEn': '4thTitleEn', '4thNameEn': '4thNameEn',
          },
        },
      },
    },
    sideTelop: {
      appToken: '',
      subCompositionName: '',
      fields: {
        textJp: 'textJp',
        textEn: 'textEn',
      },
    },
  },
});

function getSettings() {
  return {
    outputUrl: store.get('outputUrl'),
    nameTelop: store.get('nameTelop'),
    sideTelop: store.get('sideTelop'),
  };
}

function saveSettings(settings) {
  if (settings.outputUrl !== undefined) store.set('outputUrl', settings.outputUrl);
  if (settings.nameTelop) store.set('nameTelop', settings.nameTelop);
  if (settings.sideTelop) store.set('sideTelop', settings.sideTelop);
}

function getTelopConfig(telopType) {
  return store.get(telopType === 'name' ? 'nameTelop' : 'sideTelop');
}

/** ショットタイプ別の設定を取得 (name telop用) */
function getNameShotConfig(shotType) {
  const nameTelop = store.get('nameTelop');
  const shotConfig = nameTelop.shots && nameTelop.shots[shotType];
  if (!shotConfig) return { appToken: nameTelop.appToken, subCompositionName: '', fields: {} };
  return {
    appToken: nameTelop.appToken,
    subCompositionName: shotConfig.subCompositionName,
    fields: shotConfig.fields || {},
  };
}

module.exports = { getSettings, saveSettings, getTelopConfig, getNameShotConfig };

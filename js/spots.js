/* FishHunter — spot & species knowledge base (Niigata / Nagano)
 * Pure data. No network. Coordinates are approximate access points.
 * Rules text is intentionally conservative: always defer to local fishery
 * cooperatives (漁協) and on-site signage.
 */
(function (g) {
  'use strict';
  const FH = (g.FH = g.FH || {});

  // months: Jan..Dec seasonal weight (0-1). May–Sep of the pier species are blended 60/40 with the
  // catch-per-visitor shape of the managed-pier logs (tools/eval/backtest.mjs).
  // temp: [min, optLow, optHigh, max] water temperature °C
  // time: relative activity by light phase
  // wave: [idealLow, idealHigh, hardMax] metres (sea)
  // windTol: comfortable wind m/s before penalty
  // water: preferred clarity — clear | stain | murky
  const SPECIES = [
    {
      id: 'aori', name: 'アオリイカ', group: 'イカ', habitat: ['sea'], color: '#ff7ab6',
      aliases: ['アオリイカ', 'アオリ', '新子'],
      months: [0, 0, 0, 0, .35, .55, .3, .35, .9, 1, .75, .2],
      temp: [14, 18, 24, 28], time: { mazume: 1, day: .55, night: .7 },
      wave: [0, .7, 1.6], windTol: 6, water: 'clear', moon: .3,
      methods: [
        { name: 'エギング', gear: '8ft前後 ML〜M / PE0.6〜0.8号 / リーダー2〜2.5号', how: 'キャスト→着底カウント→2〜3回シャクリ→フォールで抱かせる。抱きはフォール中が大半。ラインの変化に集中。' },
        { name: 'ヤエン・泳がせ', gear: '磯竿2〜3号 / 活アジ', how: '活アジを泳がせ、イカが抱いたら十分に食わせてからヤエン投入。' }
      ],
      tips: ['秋の新子は藻場・常夜灯周りの浅場に群れる', '春の親イカは藻場の産卵場を静かに狙う', '墨跡は実績のサイン。ただし古い墨に注意'],
      rules: '各港の立入禁止区域・墨の清掃マナーを厳守。'
    },
    {
      id: 'aji', name: 'アジ', group: '回遊小型', habitat: ['sea'], color: '#7ee9ff',
      aliases: ['アジ', '豆アジ', '小アジ', '中アジ'],
      months: [.1, .1, .2, .35, .54, .84, .94, .81, .91, .9, .7, .3],
      temp: [11, 16, 24, 28], time: { mazume: 1, day: .4, night: .85 },
      wave: [0, .8, 1.8], windTol: 7, water: 'clear', moon: .2,
      methods: [
        { name: 'サビキ', gear: '磯竿2〜3号 / サビキ4〜8号 / コマセカゴ', how: '足元〜中層にコマセを効かせて群れを留める。棚が合えば連発。' },
        { name: 'アジング', gear: '6ft前後 UL / エステル0.3号 / ジグヘッド0.6〜1.5g', how: '常夜灯の明暗の境をドリフト。レンジを1カウント刻みで探る。' }
      ],
      tips: ['常夜灯のある漁港は夜が本番', '群れの回遊待ちは朝マズメの30分が勝負'],
      rules: '漁港内の係留船・作業エリアに注意。'
    },
    {
      id: 'saba', name: 'サバ・イワシ', group: '回遊小型', habitat: ['sea'], color: '#8fb7ff',
      aliases: ['サバ', 'イワシ', 'サッパ', '小サバ'],
      months: [0, 0, 0, .2, .41, .68, .88, .73, .79, .8, .5, .1],
      temp: [13, 17, 25, 28], time: { mazume: 1, day: .55, night: .3 },
      wave: [0, 1, 2], windTol: 8, water: 'clear', moon: .1,
      methods: [
        { name: 'サビキ', gear: '磯竿2〜3号 / サビキ5〜8号', how: '回遊が入ると表層〜中層で入れ食い。群れが抜けたら無理に粘らない。' },
        { name: 'ジグサビキ', gear: 'シーバスロッド / ジグ20〜30g + サビキ', how: '遠投して表層〜中層を速めに巻く。' }
      ],
      tips: ['朝マズメに回遊が集中しやすい', '鳥山・ナブラは群れのサイン'],
      rules: ''
    },
    {
      id: 'inada', name: 'イナダ・ワラサ（ブリ）', group: '青物', habitat: ['sea'], color: '#5ad1a5',
      aliases: ['イナダ', 'ワラサ', 'ブリ', 'フクラギ', 'ツバス', '青物'],
      months: [.1, .1, .1, .2, .64, .51, .57, .72, .69, 1, .9, .5],
      temp: [13, 17, 24, 27], time: { mazume: 1, day: .45, night: .1 },
      wave: [.3, 1.3, 2], windTol: 8, water: 'stain', moon: 0,
      methods: [
        { name: 'ショアジギング', gear: '9.6〜10ft MH / PE1.5〜2号 / リーダー30〜40lb / メタルジグ30〜60g', how: 'フルキャスト→着底→ワンピッチジャーク。反応がなければ高速ただ巻きも。' },
        { name: 'ミノー・トップ', gear: '同上 / ヘビーシンキングミノー・ダイペン', how: 'ナブラ撃ち。朝一の表層は最優先。' }
      ],
      tips: ['朝マズメの潮目・ベイト反応を最優先', '潮が効いている外向き堤防の先端が一級'],
      rules: '混雑時のオマツリ・周囲への声かけを徹底。'
    },
    {
      id: 'sagoshi', name: 'サゴシ・サワラ', group: '青物', habitat: ['sea'], color: '#9be15d',
      aliases: ['サゴシ', 'サワラ', 'サゴシ・サワラ'],
      months: [0, 0, 0, .1, .3, .4, .4, .5, .9, 1, .8, .3],
      temp: [14, 18, 24, 27], time: { mazume: 1, day: .5, night: .1 },
      wave: [.2, 1.2, 2], windTol: 8, water: 'clear', moon: 0,
      methods: [
        { name: 'ジグ・ブレード', gear: 'シーバス〜ライトショアジギ / メタルジグ・ブレードジグ20〜40g / ワイヤーor太リーダー', how: '表層〜中層の高速巻き。歯が鋭いのでリーダーは太め。' }
      ],
      tips: ['秋の朝マズメにベイトを追って接岸', 'リーダーブレイク多発ならワイヤー併用'],
      rules: ''
    },
    {
      id: 'seabass', name: 'シーバス', group: 'スズキ', habitat: ['sea', 'river'], color: '#b0a8ff',
      aliases: ['シーバス', 'スズキ', 'セイゴ', 'フッコ'],
      months: [.4, .3, .5, .7, .8, .7, .6, .6, .8, 1, .9, .7],
      temp: [8, 14, 24, 28], time: { mazume: 1, day: .35, night: .9 },
      wave: [.4, 1.4, 2.2], windTol: 9, water: 'stain', moon: .2,
      methods: [
        { name: 'ルアー（ミノー・シンペン）', gear: '9ft前後 ML〜M / PE0.8〜1.2号 / リーダー16〜20lb', how: '流れのヨレ・明暗・サラシにドリフトで通す。ゆっくり巻くのが基本。' },
        { name: 'バイブレーション', gear: '同上 / 鉄板・樹脂バイブ14〜26g', how: '濁り・荒れ時の広範囲サーチ。ボトム付近をリフト&フォール。' }
      ],
      tips: ['河口は雨後の濁りと流れの変化がチャンス', '適度なサラシ（白波）は好条件'],
      rules: '河川内は漁協の遊漁規則を確認。'
    },
    {
      id: 'kurodai', name: 'クロダイ', group: 'タイ', habitat: ['sea'], color: '#c9d1d9',
      aliases: ['クロダイ', 'チヌ', 'カイズ'],
      months: [.1, .1, .2, .5, .61, .92, .94, .86, .81, .8, .5, .2],
      temp: [12, 17, 26, 29], time: { mazume: .95, day: .7, night: .8 },
      wave: [.2, 1, 1.8], windTol: 8, water: 'stain', moon: .1,
      methods: [
        { name: 'ヘチ・前打ち', gear: 'ヘチ竿 / カニ・イガイ', how: '堤防の際を落とし込む。潮位の変化で棚を調整。' },
        { name: 'チニング', gear: '7〜8ft L〜ML / PE0.6〜0.8号 / フリーリグ・チヌ用ワーム', how: 'ボトムをズル引き・ボトムバンプ。甲殻類を意識。' },
        { name: 'フカセ', gear: '磯竿1〜1.5号 / 円錐ウキ / オキアミ', how: 'コマセと付けエサを同調させる。' }
      ],
      tips: ['適度な濁りと波っ気で警戒心が緩む', '日中でもボトム攻めで反応'],
      rules: ''
    },
    {
      id: 'madai', name: 'マダイ', group: 'タイ', habitat: ['sea'], color: '#ff8f6b',
      aliases: ['マダイ', '真鯛', 'チャリコ'],
      months: [.1, .1, .2, .5, .81, .82, .76, .71, .72, .7, .5, .2],
      temp: [13, 17, 24, 27], time: { mazume: 1, day: .6, night: .3 },
      wave: [.2, 1.2, 1.8], windTol: 7, water: 'clear', moon: 0,
      methods: [
        { name: '遠投カゴ・フカセ', gear: '磯竿3〜4号 / 遠投カゴ / オキアミ', how: '潮通しの良い沖向きに遠投。棚は深めから探る。' },
        { name: 'ショアラバ・タイラバ（岸）', gear: 'ライトショアジギ / タイラバ40〜60g', how: '着底→一定速度巻き。巻き速度を変えず食わせる。' }
      ],
      tips: ['潮通しの良い磯・外洋向き堤防で実績', '潮が動くタイミングに集中'],
      rules: ''
    },
    {
      id: 'kisu', name: 'シロギス', group: '底物', habitat: ['sea'], color: '#ffe08a',
      aliases: ['シロギス', 'キス', 'ピンギス'],
      months: [0, 0, 0, .2, .6, 1, 1, .9, .8, .5, .2, 0],
      temp: [15, 19, 26, 29], time: { mazume: .85, day: 1, night: .05 },
      wave: [0, .6, 1.2], windTol: 7, water: 'clear', moon: 0,
      methods: [
        { name: 'ちょい投げ・投げ釣り', gear: '投げ竿 / PE0.8〜1号 / 天秤 / 仕掛け2〜3本針 / 石ゴカイ・ジャリメ', how: '遠投→ゆっくりサビいてアタリの出る距離を見つける。群れの距離を集中攻め。' }
      ],
      tips: ['凪の砂浜が最高条件', 'アタリの多い距離をメモすると効率UP'],
      rules: '海水浴場の遊泳期間・区域は釣り禁止の場合あり。'
    },
    {
      id: 'hirame', name: 'ヒラメ', group: '底物', habitat: ['sea'], color: '#d6b36a',
      aliases: ['ヒラメ', 'ソゲ', 'マゴチ', 'フラットフィッシュ'],
      months: [.3, .2, .3, .5, .6, .5, .3, .3, .5, .8, 1, .8],
      temp: [10, 14, 22, 26], time: { mazume: 1, day: .55, night: .15 },
      wave: [.4, 1.2, 1.8], windTol: 8, water: 'stain', moon: 0,
      methods: [
        { name: 'サーフルアー', gear: '10〜11ft M / PE1〜1.5号 / メタルジグ30〜40g・ヘビーシンキングミノー・ワーム', how: '離岸流・払い出し・カケアガリをボトム付近で。ジグはリフト&フォール。' },
        { name: '泳がせ', gear: '磯竿3号 / 活アジ・活イワシ', how: 'ベイトが寄っている時に最強。' }
      ],
      tips: ['適度な波とベイトの接岸が鍵', 'サーフの地形変化（離岸流）を最優先'],
      rules: 'サーフは離岸流・高波に最大限注意。'
    },
    {
      id: 'kasago', name: 'カサゴ・メバル（根魚）', group: '根魚', habitat: ['sea'], color: '#ff9f43',
      aliases: ['カサゴ', 'メバル', 'ソイ', 'アイナメ', '根魚', 'ロックフィッシュ'],
      months: [.8, .8, .9, .9, .8, .6, .5, .5, .6, .7, .8, .9],
      temp: [7, 11, 20, 25], time: { mazume: .95, day: .45, night: 1 },
      wave: [0, .8, 1.5], windTol: 7, water: 'clear', moon: .2,
      methods: [
        { name: '穴釣り・ブラクリ', gear: '短竿 / ブラクリ3〜5号 / サバ切り身・イソメ', how: 'テトラの穴・岸壁際に落としてすぐ反応を見る。' },
        { name: 'メバリング・ロックゲーム', gear: '7ft前後 UL〜L / PE0.3〜0.6号 / ジグヘッド1〜3g・テキサス', how: 'メバルは表層スロー、カサゴはボトム。根掛かり回避にテキサス。' }
      ],
      tips: ['常夜灯の明暗・テトラ帯は通年の保険', '凪の夜が最良'],
      rules: 'テトラ帯は転落事故多発。単独釣行は避ける。'
    },
    {
      id: 'sakuramasu', name: 'サクラマス', group: 'マス', habitat: ['river', 'sea', 'lake'], color: '#ff6b8b',
      aliases: ['サクラマス', 'サクラ', '本マス'],
      months: [0, .1, .6, 1, .8, .3, 0, 0, 0, 0, 0, 0],
      temp: [4, 7, 12, 16], time: { mazume: 1, day: .6, night: .05 },
      wave: [0, 1, 1.8], windTol: 8, water: 'stain', moon: 0,
      methods: [
        { name: 'ミノー・スプーン', gear: '9ft前後 ML〜M / ナイロン12〜16lb or PE / ミノー・スプーン10〜20g', how: '流れに対してアップクロス〜ダウンクロス。ミノーのドリフトで流心の脇を通す。' }
      ],
      tips: ['雪代・増水後の引き水で遡上が進む', '一日一本の世界。朝一の一投に集中'],
      rules: '新潟県内のサクラマス釣りは河川ごとに特別な承認・期間・区間の定めあり。必ず漁協に確認。'
    },
    {
      id: 'yamame', name: 'ヤマメ・アマゴ', group: '渓流', habitat: ['river'], color: '#ff9ecd',
      aliases: ['ヤマメ', 'アマゴ', '渓流'],
      months: [0, .2, .6, .9, 1, .9, .7, .6, .5, 0, 0, 0],
      temp: [5, 10, 16, 20], time: { mazume: 1, day: .65, night: 0 },
      water: 'stain', windTol: 7, moon: 0,
      methods: [
        { name: 'ミノー', gear: '5ft前後 UL〜L / ナイロン4〜5lb / シンキングミノー4〜5cm', how: 'アップストリームで瀬尻・岩裏をトゥイッチ。' },
        { name: 'エサ釣り（ミャク釣り）', gear: '渓流竿5〜6m / 目印 / イクラ・川虫・ミミズ', how: '流れに自然に乗せる。目印の変化で合わせる。' },
        { name: 'テンカラ・フライ', gear: 'テンカラ竿 / 毛鉤', how: '水面〜水面直下のライズを狙う。' }
      ],
      tips: ['増水後の引き水・ささ濁りは大チャンス', '日中は日陰・深みに付く'],
      rules: '長野県内の渓流は概ね2月中旬〜9月末（河川・漁協で異なる）。遊漁券必須。'
    },
    {
      id: 'iwana', name: 'イワナ', group: '渓流', habitat: ['river', 'lake'], color: '#f7c59f',
      aliases: ['イワナ', '岩魚'],
      months: [0, .1, .4, .7, .9, 1, .9, .8, .6, 0, 0, 0],
      temp: [3, 8, 14, 18], time: { mazume: 1, day: .6, night: .05 },
      water: 'stain', windTol: 7, moon: 0,
      methods: [
        { name: 'ミノー・スプーン', gear: 'UL〜L / ナイロン4〜6lb / ミノー5cm・スプーン3〜5g', how: '落ち込み・巻き返し・淵尻を丁寧に。' },
        { name: 'エサ釣り', gear: '渓流竿 / ミミズ・川虫', how: '白泡の下・岩の奥へ送り込む。' }
      ],
      tips: ['源流部・水温の低い区間が主戦場', '夏は早朝と沢の出合い'],
      rules: '源流・山岳地帯は熊対策（鈴・スプレー）と単独行動回避を。遊漁券必須。'
    },
    {
      id: 'niji', name: 'ニジマス（大型）', group: 'マス', habitat: ['river', 'lake'], color: '#ff9a76',
      aliases: ['ニジマス', 'レインボー', 'ドナルドソン'],
      months: [.3, .4, .6, .8, .9, .7, .4, .4, .5, .6, .6, .4],
      temp: [4, 9, 16, 20], time: { mazume: 1, day: .6, night: .1 },
      water: 'stain', windTol: 7, moon: 0,
      methods: [
        { name: 'ミノー・スプーン', gear: '7〜9ft L〜ML / ナイロン8〜12lb / ミノー7〜9cm・スプーン7〜14g', how: '本流の流芯脇・ブレイクをダウンクロスでドリフト。' },
        { name: 'ルアー（湖）', gear: 'ロングロッド / スプーン・ミノー', how: 'ワンドや流れ込み周りを遠投で広く。' }
      ],
      tips: ['本流大型は増水後の引き水・ささ濁りがチャンス', '冬は深場・緩流帯でスロー'],
      rules: '区間により通年釣り場あり。漁協規則で確認。'
    },
    {
      id: 'ayu', name: 'アユ', group: '河川', habitat: ['river'], color: '#b8f28c',
      aliases: ['アユ', '鮎'],
      months: [0, 0, 0, 0, 0, .8, 1, 1, .8, .3, 0, 0],
      temp: [14, 18, 23, 26], time: { mazume: .6, day: 1, night: 0 },
      water: 'clear', windTol: 7, moon: 0,
      methods: [
        { name: '友釣り', gear: '友竿8.5〜9m / 水中糸 / 掛け針', how: 'オトリを瀬に泳がせ、縄張りアユの体当たりを掛ける。' },
        { name: 'アユルアー', gear: '専用ロッド / アユイングルアー', how: '対応区間のみ。流れの中を泳がせる。' }
      ],
      tips: ['増水直後は釣りにならない。水位が落ち着き苔が付くまで待つ', '日照があり水温が上がる昼前後がピーク'],
      rules: '解禁日・区間・釣法（ルアー可否）は河川ごとに異なる。遊漁券必須。'
    },
    {
      id: 'bass', name: 'スモールマウスバス', group: 'バス', habitat: ['lake', 'river'], color: '#6fe3c8',
      aliases: ['スモールマウス', 'スモール', 'ブラックバス', 'バス'],
      months: [.1, .1, .2, .5, .9, 1, .9, .8, .9, .8, .5, .2],
      temp: [8, 15, 24, 28], time: { mazume: 1, day: .65, night: .15 },
      water: 'clear', windTol: 7, moon: .1,
      methods: [
        { name: 'ライトリグ', gear: '6〜7ft UL〜L / フロロ3〜4lb or PE0.4号 / ネコリグ・ダウンショット・ジグヘッド', how: 'ブレイク・岬・ハンプを丁寧に。スモールは中層ミドストも強い。' },
        { name: '巻き物', gear: 'ML〜M / シャッド・スピナーベイト', how: '風の当たるバンクや濁り時に広く探す。' }
      ],
      tips: ['風の当たる岬・シャローフラットに差してくる', '晴天無風はディープ・スロー'],
      rules: '湖ごとに遊漁期間・遊漁券・リリース規定あり（外来生物法の運搬禁止を遵守）。'
    },
    {
      id: 'wakasagi', name: 'ワカサギ', group: '湖', habitat: ['lake'], color: '#c2e7ff',
      aliases: ['ワカサギ'],
      months: [.9, 1, .8, .3, 0, 0, 0, 0, .3, .7, .9, .95],
      temp: [1, 4, 14, 20], time: { mazume: 1, day: .85, night: .1 },
      water: 'clear', windTol: 6, moon: 0,
      methods: [
        { name: 'ドーム船・桟橋', gear: 'ワカサギ竿・電動リール / 仕掛け0.5〜2号 / 紅サシ・白サシ', how: '群れの棚を見つけて誘い→止め。エサはこまめに交換。' },
        { name: '氷上穴釣り', gear: '短竿 / 仕掛け / 防寒装備', how: '結氷状況は必ず管理者の安全判断に従う。' }
      ],
      tips: ['朝一の群れが濃い', '棚がずれたら早めに探り直し'],
      rules: '湖ごとに解禁期間・遊漁券あり。氷上は管理者の開放情報のみを信用。'
    },
    {
      id: 'mejina', name: 'メジナ', group: '磯・堤防', habitat: ['sea'], color: '#7fb4d9',
      aliases: ['メジナ', 'グレ', '口太'],
      months: [.6, .5, .5, .6, .7, .6, .5, .5, .6, .8, .9, .8],
      temp: [10, 14, 21, 26], time: { mazume: .9, day: .9, night: .25 },
      wave: [.3, 1.1, 1.8], windTol: 8, water: 'stain', moon: 0,
      methods: [
        { name: 'フカセ', gear: '磯竿1〜1.5号 / 道糸2〜3号 / ハリス1.5〜2号 / 円錐ウキ / オキアミ＋配合餌', how: '撒き餌と付け餌を同調させ、潮下へ流す。食いが渋ければハリスを落とし、ウキ下を細かく調整。' },
        { name: 'ウキ釣り（堤防）', gear: '磯竿 / 棒ウキ・円錐ウキ / オキアミ', how: '足元〜際の撒き餌で浮かせて釣る。' }
      ],
      tips: ['サラシや適度な波っ気で警戒心が下がる', '秋〜冬は型が良く、群れで入る'],
      rules: '磯は波・滑落に注意。撒き餌の禁止区域は現地ルールに従う。'
    },
    {
      id: 'kawahagi', name: 'カワハギ', group: '底物', habitat: ['sea'], color: '#c7b27a',
      aliases: ['カワハギ', 'ウマズラハギ', 'ウマヅラ', 'ハゲ'],
      months: [0, 0, 0, .1, .25, .35, .48, .77, 1, .9, .6, .2],
      temp: [14, 18, 24, 27], time: { mazume: .7, day: 1, night: .05 },
      wave: [0, .7, 1.3], windTol: 7, water: 'clear', moon: 0,
      methods: [
        { name: '胴付き（アサリ餌）', gear: 'カワハギ竿・ライトロッド / 胴付き仕掛け / ハリス2〜3号 / アサリ・イソメ', how: '堤防際・テトラ際・海藻周りを探り、止め・たるませで食わせる。餌取り名人なので小さめの針で。' },
        { name: 'ちょい投げ', gear: 'ちょい投げ竿 / 天秤 / アサリ・イソメ', how: '根周りの砂地をゆっくりサビく。' }
      ],
      tips: ['水温の高い晩夏〜秋が数釣りのピーク', 'アタリは小さい。聞き合わせで掛ける'],
      rules: ''
    },
    {
      id: 'shiira', name: 'シイラ', group: '青物', habitat: ['sea'], color: '#ffd43b',
      aliases: ['シイラ', 'ペンペン', 'マヒマヒ'],
      months: [0, 0, 0, 0, 0, .2, .6, .9, 1, .5, .1, 0],
      temp: [20, 23, 28, 31], time: { mazume: 1, day: .75, night: .05 },
      wave: [.2, 1.2, 1.8], windTol: 8, water: 'clear', moon: 0,
      methods: [
        { name: 'トップ・ミノー', gear: '10ft前後 MH〜H / PE2〜3号 / リーダー40〜50lb / ダイビングペンシル・ポッパー・ミノー', how: '潮目や漂流物周りを表層で速く引く。ヒット後は強引にやり取り。' }
      ],
      tips: ['黒潮系の暖水が入った晩夏に岸から狙えるチャンス', '外向きの潮通しの良い堤防先端で回遊待ち'],
      rules: '大型は取り込み用のギャフ・タモ網を準備。周囲との間隔に注意。'
    }
  ];

  // face: compass direction (deg) the shoreline faces toward open water (sea spots).
  const SPOTS = [
    // ── 新潟・上越 / 糸魚川 ─────────────────────────────
    { id: 'oyashirazu', feedAliases: ['親不知', '親知らず'], name: '親不知', pref: '新潟', area: '上越', type: '磯・ゴロタ', water: 'sea', lat: 36.985, lon: 137.705, face: 330, depth: 'deep',
      species: ['inada', 'sagoshi', 'aori', 'kasago', 'madai', 'hirame', 'mejina', 'shiira'],
      feature: '急深な海岸。潮通しが良く、青物回遊の期待が高い。足場が険しい箇所が多い。', caution: '落石・高波。うねりが残る日は近づかない。' },
    { id: 'himeko', feedAliases: ['姫川港', '姫川河口', '姫川'], name: '姫川港', pref: '新潟', area: '上越', type: '港湾・河口', water: 'sea', lat: 37.049, lon: 137.838, face: 330, depth: 'mid',
      species: ['seabass', 'inada', 'sagoshi', 'aji', 'saba', 'aori', 'kasago'],
      feature: '姫川河口に隣接。河川水の流入でベイトが溜まりやすい。', caution: '港湾施設の立入禁止区域に注意。' },
    { id: 'nou-port', feedAliases: ['能生漁港', '能生港', '能生', 'マリンドリーム能生'], name: '能生漁港', pref: '新潟', area: '上越', type: '漁港', water: 'sea', lat: 37.097, lon: 137.983, face: 330, depth: 'mid',
      species: ['aori', 'aji', 'saba', 'kasago', 'kurodai', 'inada', 'mejina', 'kawahagi'],
      feature: '藻場のある磯が近く、秋のアオリイカで人気。', caution: '漁業者の作業優先。駐車マナー厳守。' },
    { id: 'tsutsuishi', feedAliases: ['筒石漁港', '筒石'], name: '筒石漁港', pref: '新潟', area: '上越', type: '漁港', water: 'sea', lat: 37.119, lon: 138.036, face: 330, depth: 'mid',
      species: ['aori', 'aji', 'kasago', 'kurodai', 'saba', 'mejina'],
      feature: '舟屋の町並みが残る小規模漁港。周辺の磯場と合わせて探れる。', caution: '生活圏。騒音・ゴミに特に配慮。' },
    { id: 'nadachi', feedAliases: ['名立漁港', '名立'], name: '名立漁港', pref: '新潟', area: '上越', type: '漁港', water: 'sea', lat: 37.170, lon: 138.099, face: 330, depth: 'mid',
      species: ['aori', 'aji', 'saba', 'kasago', 'kurodai', 'kisu'],
      feature: '道の駅に近くアクセス良好。港内外で多魚種。', caution: '' },
    { id: 'naoetsu', feedAliases: ['直江津港', '直江津', '第3東防波堤', '第三東防波堤', 'ハッピーフィッシング直江津'], name: '直江津港', pref: '新潟', area: '上越', type: '港湾（管理釣り場あり）', water: 'sea', lat: 37.186, lon: 138.243, face: 340, depth: 'deep',
      species: ['inada', 'sagoshi', 'aji', 'saba', 'seabass', 'kurodai', 'aori', 'madai', 'mejina', 'kawahagi', 'shiira'],
      feature: '大型港湾。第3東防波堤はNPO法人による管理釣り場として運営（利用条件は公式で確認）。', caution: '管理釣り場は開場日・料金・ルールを公式サイトで確認。' },
    { id: 'kuroi', feedAliases: ['黒井突堤', '黒井'], name: '黒井突堤', pref: '新潟', area: '上越', type: '突堤・サーフ', water: 'sea', lat: 37.203, lon: 138.276, face: 340, depth: 'shallow',
      species: ['kisu', 'hirame', 'seabass', 'inada', 'sagoshi', 'saba'],
      feature: '砂浜に突き出した突堤。サーフの魚と回遊魚を両狙いできる。', caution: '波を被りやすい。高波時は立入らない。' },
    { id: 'kakizaki', feedAliases: ['柿崎', '上下浜'], name: '柿崎・上下浜', pref: '新潟', area: '上越', type: 'サーフ', water: 'sea', lat: 37.270, lon: 138.380, face: 320, depth: 'shallow',
      species: ['kisu', 'hirame', 'seabass', 'inada'],
      feature: '遠浅のサーフが続く。キス・ヒラメの好フィールド。', caution: '離岸流に注意。' },
    // ── 新潟・中越 ──────────────────────────────────
    { id: 'kashiwazaki', feedAliases: ['柏崎港', '柏崎'], name: '柏崎港', pref: '新潟', area: '中越', type: '港湾（管理釣り場あり）', water: 'sea', lat: 37.360, lon: 138.535, face: 320, depth: 'mid',
      species: ['aji', 'saba', 'inada', 'sagoshi', 'kurodai', 'aori', 'kasago', 'mejina', 'kawahagi'],
      feature: '中越の主要港。防波堤からの回遊魚が中心。', caution: '管理エリアのルールを確認。' },
    { id: 'kujiranami', feedAliases: ['鯨波', '番神'], name: '鯨波・番神', pref: '新潟', area: '中越', type: '磯・サーフ', water: 'sea', lat: 37.345, lon: 138.515, face: 300, depth: 'mid',
      species: ['kurodai', 'aori', 'kasago', 'kisu', 'hirame', 'madai', 'mejina'],
      feature: '磯とサーフが混在。夏場は海水浴客に配慮。', caution: '遊泳区域での釣りは不可。' },
    { id: 'izumozaki', feedAliases: ['出雲崎'], name: '出雲崎', pref: '新潟', area: '中越', type: '漁港・磯', water: 'sea', lat: 37.535, lon: 138.707, face: 300, depth: 'mid',
      species: ['aori', 'kurodai', 'kasago', 'aji', 'madai', 'mejina'],
      feature: '夕日の名所。周辺の磯・小港を回遊しながら探れる。', caution: '' },
    { id: 'teradomari', feedAliases: ['寺泊港', '寺泊'], name: '寺泊港', pref: '新潟', area: '中越', type: '漁港', water: 'sea', lat: 37.642, lon: 138.764, face: 290, depth: 'mid',
      species: ['aji', 'saba', 'kurodai', 'aori', 'kasago', 'inada', 'mejina', 'kawahagi'],
      feature: '魚市場通りで有名な港町。港内外で手軽に狙える。', caution: '観光客・車両の往来に注意。' },
    { id: 'ohkouzu', feedAliases: ['大河津分水', '大河津', '野積'], name: '大河津分水 河口', pref: '新潟', area: '中越', type: '河口', water: 'sea', lat: 37.666, lon: 138.790, face: 300, depth: 'shallow',
      species: ['seabass', 'hirame', 'kurodai', 'sakuramasu'],
      feature: '信濃川の分水河口。雨後の濁り・流れでシーバスの実績。', caution: '増水時は絶対に近づかない。' },
    // ── 新潟・下越 ──────────────────────────────────
    { id: 'niigata-west', feedAliases: ['新潟西港', '西港', 'みなとトンネル'], name: '新潟西港', pref: '新潟', area: '下越', type: '港湾・河口', water: 'sea', lat: 37.935, lon: 139.058, face: 330, depth: 'deep',
      species: ['seabass', 'kurodai', 'aji', 'saba', 'inada', 'sagoshi'],
      feature: '信濃川河口の大型港。都市型シーバスの定番エリア。', caution: '港湾保安区域は立入禁止。' },
    { id: 'niigata-east', feedAliases: ['新潟東港', '東港', 'ハッピーフィッシング東港', 'ハッピーフィシング東港'], name: '新潟東港', pref: '新潟', area: '下越', type: '港湾（管理釣り場あり）', water: 'sea', lat: 37.995, lon: 139.228, face: 330, depth: 'deep',
      species: ['inada', 'sagoshi', 'aji', 'saba', 'kurodai', 'seabass', 'madai', 'aori', 'mejina', 'kawahagi', 'shiira'],
      feature: '防波堤の一部はNPO法人による管理釣り場として運営。青物の実績多数。', caution: '管理釣り場の開場条件は公式で確認。' },
    { id: 'aganogawa', feedAliases: ['阿賀野川'], name: '阿賀野川 河口', pref: '新潟', area: '下越', type: '河口', water: 'sea', lat: 37.962, lon: 139.117, face: 330, depth: 'shallow',
      species: ['seabass', 'hirame', 'kurodai', 'sakuramasu'],
      feature: '大河川の河口。ベイト・流れが豊富。', caution: '河川内は漁協の規則を確認。' },
    { id: 'iwafune', feedAliases: ['岩船港', '岩船'], name: '岩船港', pref: '新潟', area: '下越', type: '港湾', water: 'sea', lat: 38.195, lon: 139.420, face: 300, depth: 'mid',
      species: ['aji', 'saba', 'aori', 'kurodai', 'inada', 'kasago'],
      feature: '村上エリアの拠点港。佐渡汽船・漁港の複合。', caution: '' },
    { id: 'sasagawa', feedAliases: ['笹川流れ', '寝屋漁港', '桑川'], name: '笹川流れ', pref: '新潟', area: '下越', type: '磯', water: 'sea', lat: 38.380, lon: 139.475, face: 280, depth: 'deep',
      species: ['aori', 'kurodai', 'madai', 'kasago', 'inada', 'hirame', 'mejina', 'shiira'],
      feature: '奇岩が連なる景勝地。透明度が高く磯の釣りが魅力。', caution: '磯場は波・滑落に注意。ライフジャケット必携。' },
    // ── 佐渡 ────────────────────────────────────────
    { id: 'ryotsu', feedAliases: ['両津港', '両津', '加茂湖'], name: '両津港', pref: '新潟', area: '佐渡', type: '港湾', water: 'sea', lat: 38.083, lon: 138.438, face: 90, depth: 'mid',
      species: ['aji', 'saba', 'aori', 'inada', 'kurodai', 'kasago', 'mejina', 'kawahagi'],
      feature: '佐渡の玄関口。加茂湖に隣接し多彩な魚種。', caution: 'フェリー発着エリアは立入不可。' },
    { id: 'washizaki', feedAliases: ['鷲崎'], name: '鷲崎', pref: '新潟', area: '佐渡', type: '磯・漁港', water: 'sea', lat: 38.320, lon: 138.510, face: 0, depth: 'deep',
      species: ['inada', 'madai', 'aori', 'kasago', 'kurodai', 'mejina', 'shiira'],
      feature: '佐渡北端。潮通し抜群の外洋エリア。', caution: '北西風時は大荒れ。' },
    { id: 'ogi', feedAliases: ['小木港', '小木'], name: '小木港', pref: '新潟', area: '佐渡', type: '港湾・磯', water: 'sea', lat: 37.815, lon: 138.284, face: 200, depth: 'mid',
      species: ['aori', 'aji', 'kurodai', 'madai', 'kasago', 'inada', 'mejina', 'kawahagi'],
      feature: '佐渡南端。冬の北西風の影響を受けにくい南向き。', caution: '' },
    // ── 新潟・内水面 ─────────────────────────────────
    { id: 'uonogawa', feedAliases: ['魚野川'], name: '魚野川', pref: '新潟', area: '中越', type: '河川', water: 'river', lat: 37.110, lon: 138.935, elev: 200,
      species: ['ayu', 'yamame', 'iwana', 'niji', 'sakuramasu'],
      feature: '魚沼の清流。アユ・渓流魚・サクラマスの名川。', caution: '雪代期は水量・水温変化が大きい。' },
    { id: 'arakawa', feedAliases: ['荒川'], name: '荒川（村上）', pref: '新潟', area: '下越', type: '河川', water: 'river', lat: 38.120, lon: 139.500, elev: 30,
      species: ['ayu', 'sakuramasu', 'yamame', 'seabass'],
      feature: 'サクラマス・アユで知られる清流。', caution: 'サクラマスは特別な承認・期間の定めあり。' },
    { id: 'okutadami', feedAliases: ['奥只見湖', '奥只見', '銀山湖'], name: '奥只見湖', pref: '新潟', area: '中越', type: 'ダム湖', water: 'lake', lat: 37.150, lon: 139.240, elev: 780,
      species: ['iwana', 'sakuramasu', 'niji'],
      feature: '山深い大型ダム湖。ボートでの大型トラウト狙い。', caution: '期間・遊漁券・ボート規定あり。天候急変に注意。' },
    // ── 長野・北信 ──────────────────────────────────
    { id: 'nojiri', feedAliases: ['野尻湖'], name: '野尻湖', pref: '長野', area: '北信', type: '湖', water: 'lake', lat: 36.827, lon: 138.216, elev: 657,
      species: ['bass', 'wakasagi', 'niji'],
      feature: 'スモールマウスバスの聖地。秋〜冬はドーム船ワカサギ。', caution: '遊漁期間・遊漁券・禁止エリアは漁協で確認。' },
    { id: 'chikuma-nagano', feedAliases: ['千曲川（長野', '千曲川 長野', '須坂'], name: '千曲川（長野市〜須坂）', pref: '長野', area: '北信', type: '本流', water: 'river', lat: 36.650, lon: 138.270, elev: 340,
      species: ['niji', 'ayu', 'bass', 'yamame'],
      feature: '犀川合流を含む本流域。大型ニジマス・スモールの実績。', caution: '本流は流れが強く水位変化も大きい。' },
    { id: 'saikawa', feedAliases: ['犀川'], name: '犀川（安曇野〜信州新町）', pref: '長野', area: '中信', type: '本流', water: 'river', lat: 36.440, lon: 137.960, elev: 480,
      species: ['niji', 'yamame', 'iwana'],
      feature: 'ダム放流の影響を受ける本流。大型レインボーの名川。', caution: 'ダム放流による急な増水に最大限注意。' },
    // ── 長野・中信 ──────────────────────────────────
    { id: 'kizaki', feedAliases: ['木崎湖'], name: '木崎湖', pref: '長野', area: '中信', type: '湖', water: 'lake', lat: 36.555, lon: 137.835, elev: 764,
      species: ['bass', 'wakasagi', 'niji'],
      feature: '仁科三湖の一つ。スモールマウス・ワカサギ。', caution: '遊漁券必須。' },
    { id: 'aoki', feedAliases: ['青木湖'], name: '青木湖', pref: '長野', area: '中信', type: '湖', water: 'lake', lat: 36.617, lon: 137.852, elev: 822,
      species: ['niji', 'iwana', 'bass'],
      feature: '透明度の高い深い湖。トラウトの実績。', caution: '遊漁規則を確認。' },
    { id: 'azusa', feedAliases: ['梓川'], name: '梓川', pref: '長野', area: '中信', type: '渓流〜本流', water: 'river', lat: 36.225, lon: 137.850, elev: 650,
      species: ['iwana', 'yamame', 'niji'],
      feature: '北アルプス由来の冷水。イワナ・ニジマス。', caution: 'ダム放流・急な増水に注意。' },
    { id: 'takase', feedAliases: ['高瀬川'], name: '高瀬川', pref: '長野', area: '中信', type: '渓流', water: 'river', lat: 36.500, lon: 137.820, elev: 650,
      species: ['iwana', 'yamame', 'niji'],
      feature: '北アルプスからの清冽な流れ。', caution: '熊・増水に注意。' },
    { id: 'narai', feedAliases: ['奈良井川'], name: '奈良井川', pref: '長野', area: '中信', type: '渓流', water: 'river', lat: 36.050, lon: 137.850, elev: 800,
      species: ['iwana', 'yamame'],
      feature: '木曽谷へ続く渓流。', caution: '遊漁券必須。' },
    // ── 長野・東信 ──────────────────────────────────
    { id: 'chikuma-ueda', feedAliases: ['上田', '千曲川（上田'], name: '千曲川（上田）', pref: '長野', area: '東信', type: '本流', water: 'river', lat: 36.395, lon: 138.255, elev: 440,
      species: ['ayu', 'niji', 'yamame'],
      feature: '大型アユで知られる区間。', caution: '解禁日・区間を漁協で確認。' },
    { id: 'matsubara', feedAliases: ['松原湖'], name: '松原湖', pref: '長野', area: '東信', type: '湖', water: 'lake', lat: 36.052, lon: 138.440, elev: 1123,
      species: ['wakasagi', 'niji'],
      feature: '高原の湖。冬は結氷状況次第で氷上ワカサギ。', caution: '氷上は管理者の解禁発表に従う。' },
    // ── 長野・南信 ──────────────────────────────────
    { id: 'suwa', feedAliases: ['諏訪湖'], name: '諏訪湖', pref: '長野', area: '南信', type: '湖', water: 'lake', lat: 36.047, lon: 138.085, elev: 759,
      species: ['wakasagi', 'bass'],
      feature: 'ワカサギの名湖。ドーム船・桟橋釣りが中心。', caution: '遊漁期間・遊漁券は漁協で確認。' },
    { id: 'tenryu', feedAliases: ['天竜川'], name: '天竜川（伊那）', pref: '長野', area: '南信', type: '本流', water: 'river', lat: 35.840, lon: 137.960, elev: 630,
      species: ['ayu', 'yamame', 'niji'],
      feature: 'アユ・アマゴの本流。', caution: 'ダム放流・増水に注意。' },
    { id: 'kiso', feedAliases: ['木曽川'], name: '木曽川（上松）', pref: '長野', area: '南信', type: '渓流〜本流', water: 'river', lat: 35.780, lon: 137.695, elev: 700,
      species: ['ayu', 'yamame', 'iwana'],
      feature: '渓谷美と大型アマゴ・イワナ。', caution: '岩盤帯は滑落に注意。' }
  ];

  const AREAS = ['上越', '中越', '下越', '佐渡', '北信', '中信', '東信', '南信'];

  FH.SPECIES = SPECIES;
  FH.SPOTS = SPOTS;
  FH.AREAS = AREAS;
  FH.speciesById = Object.fromEntries(SPECIES.map((s) => [s.id, s]));
  FH.spotById = Object.fromEntries(SPOTS.map((s) => [s.id, s]));
})(typeof globalThis !== 'undefined' ? globalThis : this);

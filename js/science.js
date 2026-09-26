/* FishHunter — 研究メモ: ecology findings for Japan Sea species, each with its public source.
 * Only official data / peer-reviewed papers / prefectural institute reports (see ops/research-ecology.md).
 * [text, source label, url]
 */
(function (g) {
  'use strict';
  const FH = (g.FH = g.FH || {});
  const JFA = ['水産庁（豊かな海づくり推進協会）発育段階の生態的知見', 'https://www.jfa.maff.go.jp/j/gyoko_gyozyo/g_thema/pdf/sub40b.pdf'];
  const NIIGATA_TREND = ['新潟県 主要魚種の漁獲動向 令和7年版', 'https://www.pref.niigata.lg.jp/uploaded/attachment/468712.pdf'];
  const NIIGATA_SEA = ['新潟県水産海洋研究所 海況情報', 'https://www.pref.niigata.lg.jp/site/suisan-kenkyu/kaikyou.html'];
  FH.SCIENCE = {
    _sea: [
      ['新潟沖の表面水温は8〜9月に27〜30℃、同じ時期の水深50mは約20℃。夏は魚が表層を避けて少し深いタナにいることが多い。', ...NIIGATA_SEA],
      ['日中の潮位差は15〜30cmほどで、潮回りの影響は小さい。FishHunterの釣果日誌でも潮名と釣果に一貫した関係はなかった。', '気象庁 潮位表（新潟東港）', 'https://www.data.jma.go.jp/kaiyou/db/tide/suisan/suisan.php?stn=I5'],
      ['気圧そのものが釣果を左右するという確かな証拠は乏しい（総説）。気圧変化は前線など天気の変わり目の目印と考えるのが妥当。', 'Lennox et al. 2017, Fish and Fisheries', 'https://www.fecpl.ca/wp-content/uploads/2017/02/Lennox-et-al.-2017-FishFish.pdf']
    ],
    aji: [
      ['島根沿岸では16℃以上の水塊の量と5〜7月の漁獲がよく相関（r=0.81）。16℃が接岸の目安。', '森脇・寺門 2012 島根水技セ研報', 'https://www.pref.shimane.lg.jp/industry/suisan/shinkou/suigi/publish/kenkyuhou/017/index.data/05maaji.pdf'],
      ['対馬暖流系群は春〜夏に北上、秋〜冬に南下。1歳で16〜18cm、2歳で22〜24cm。', '水産機構 マアジ対馬暖流系群 資源評価', 'https://www.fra.go.jp/shigen/fisheries_resources/meeting/stock_assesment_meeting/2024/files/sa2024-sc10/fra-sa2024-sc10-01.pdf']
    ],
    saba: [
      ['マサバの分布は15℃の等温線に沿う。昼は深く（100〜150m）、夜は浅く（10〜50m）なる日周移動をする。', '黒田ほか 2019 水産海洋研究', 'https://www.jstage.jst.go.jp/article/jsfo/83/4/83_237/_article/-char/ja/'],
      ['新潟の定置網ではサバが近年増加傾向（2025年1〜8月は5年平均の147%）。', ...NIIGATA_TREND]
    ],
    inada: [
      ['ブリは主に1〜7月に産卵し、13cm前後から魚食性に。1歳で約37cm、2歳で約53cm。', '水産機構 ブリ資源評価', 'https://www.fra.go.jp/shigen/fisheries_resources/meeting/stock_assesment_meeting/2024/files/sa2024-sc15/fra-sa2024-sc15-01.pdf'],
      ['新潟〜兵庫の定置網では2歳以上の漁期が4〜7月（5月ピーク）と11〜3月（12〜1月ピーク）。寒ブリの南下は津軽海峡付近の水深100mが14℃になるのが合図。', '新潟県水産海洋研究所 寒ブリ漁況の見通し', 'https://www.pref.niigata.lg.jp/uploaded/attachment/469896.pdf']
    ],
    sagoshi: [
      ['東シナ海で5〜6月に生まれ、9月ごろ約40cmで日本海へ。秋の新潟はサゴシ（当歳）、春は1kg超のサワラ。', '兵庫県但馬水産技術センター「日本海で急増したサワラ」', 'https://www.hyogo-suigi.jp/tajima/wp-content/uploads/sites/2/2020/11/sawara.pdf'],
      ['水温12.5℃を下回るとほぼ獲れなくなる（福岡の定置網）。', '上田・的場 2009 福岡水海技セ研報', 'https://www.sea-net.pref.fukuoka.jp/info/kenkyu/upLoad/k19-10.pdf']
    ],
    shiira: [
      ['沿岸水温が約20℃に達すると来遊し、23〜27℃で最盛期。日本海では6月から獲れ始め8〜11月が多い。', '水産機構 シイラ（日本海）資源評価調査報告書', 'https://abchan.fra.go.jp/wpt/wp-content/uploads/2025/03/trends_2024_154.pdf'],
      ['南西風の日以降は漁獲が減り、西〜北風の翌日に増える。雲量が前日より減った日に多い傾向。', '島根県水試 シイラ漁況と海況との関係', 'https://www.pref.shimane.lg.jp/industry/suisan/shinkou/suigi/publish/kenkyuhou/kenkyu01/index.data/01-06.pdf']
    ],
    aori: [
      ['日本海のアオリイカ（シロイカ型）は他地域と遺伝的に異なる独自の集団。', 'Venus 59(1)', 'https://www.jstage.jst.go.jp/article/venusjjm/59/1/59_KJ00004345042/_article/-char/ja/'],
      ['京都沿岸では水温16℃超で親イカが接岸し、5月下旬〜7月下旬に産卵。産卵水深は時期とともに深く（6月中旬には30〜40m）。', 'Wada et al. 1995 日本水産学会誌', 'https://www.jstage.jst.go.jp/article/suisan1932/61/6/61_6_838/_pdf/-char/en'],
      ['佐渡の漁期は9月中旬〜11月中旬、漁獲の中心は外套長20〜30cmの春生まれ。', '新潟県 佐渡地域振興局', 'https://www.pref.niigata.lg.jp/sec/sado_nourinsuisan/1350943310539.html'],
      ['富山の解析では、秋（9〜12月）のアオリイカ漁獲は7月の表層水温と強く正の相関。', '富山県水産研究所', 'https://taffrc.pref.toyama.jp/nsgc/suisan/wp-content/uploads/sites/14/2024/09/平成３０年度：日本海の水温データを用いた漁獲量変動解明の試み.pdf']
    ],
    kurodai: [
      ['4〜30℃で生存、15〜16℃で産卵開始（マダイより半月〜1か月遅い）。冬は沖の瀬で越冬し、5月ごろから接岸。', ...JFA],
      ['佐渡では「荒れ後はクロダイが集まり狙い目」。汽水・河川にも入って捕食する。', '新潟県 佐渡の磯釣りガイド', 'https://www.pref.niigata.lg.jp/uploaded/attachment/366948.pdf']
    ],
    madai: [
      ['粟島周辺は日本海のマダイ産卵場の一つ（水深30〜50mの岩礁）。14〜15℃で産卵開始。新潟の主漁期は10〜11月。', ...JFA],
      ['新潟の当歳魚は8月下旬に5〜6cmで水深20〜40m、9月には7〜8cmで40〜60mへ。秋のチャリコは岸から遠い。', ...JFA]
    ],
    mejina: [
      ['適水温は19〜22℃。昼に摂餌し、夜は休む。冬は海藻を多く食べる。', ...JFA],
      ['1〜2歳魚は日の出とともに岸を離れ、夜に戻る。', '東京都島しょ農林水産総合センター', 'https://www.ifarc.metro.tokyo.lg.jp/archive/27,1189,55,227.html']
    ],
    kawahagi: [
      ['産卵は5〜8月（6〜7月ピーク）。幼魚は流れ藻について育ち、水深8〜30mに着底する。', ...JFA]
    ],
    kasago: [
      ['カサゴは18〜21℃で摂餌が活発。産仔は11〜4月（12〜2月ピーク）。夕〜夜に活動。', ...JFA],
      ['若狭湾の天然キジハタは水温20℃を下回ると摂餌量が大きく減る（15℃以下で体重の約1%/日）。', '水産機構 研究トピックス', 'https://www.fra.go.jp/home/kenkyushokai/book/archive/nihon/research_topics/files/rt25_11-14.pdf'],
      ['メバル・カサゴなどの根魚は藻場で夜に密度が高く、昼はほぼいない（10〜1月の調査）。', 'Scientific Reports 7:4217', 'https://www.nature.com/articles/s41598-017-04217-3']
    ],
    hirame: [
      ['新潟の産卵期は4〜7月（5〜6月ピーク）で、この時期に浅場へ来る。新潟での漁獲水温は8〜17.5℃。', ...JFA],
      ['新潟県水産振興協会が村上で育てた稚魚を7月下旬に荒川河口周辺へ放流（約1万尾）。', '新潟県水産振興協会', 'https://www.niigata-suisan.jp/syubyouseisan']
    ],
    kisu: [
      ['8℃以下で摂餌が止まる。摂餌量は9〜11℃で体重の1.5%/日、13〜14℃で4.6%/日、27〜28℃で6.5%/日。', ...JFA],
      ['秋〜冬は水深10m以深へ移り、春〜夏に接岸。夜は物陰に群れ、明け方に散る。', ...JFA]
    ],
    seabass: [
      ['大阪湾の追跡調査では、産卵期に寒波や低気圧の通過後に護岸域を離れた。', '日本水産学会誌 69:910', 'https://www.jstage.jst.go.jp/article/suisan1932/69/6/69_6_910/_article/-char/en']
    ],
    sakuramasu: [
      ['本州では2〜3月に沿岸から川に入り、雪代の増水期に遡上。新潟〜青森の沿岸漁獲は2〜4月がピーク。', '水産機構 さけ・ます資源管理センター', 'https://www.fra.go.jp/shigen/salmon/files/salmon08_p11-14.pdf'],
      ['三面川では2月上旬には遡上魚がいて、約0.37km/日で上り、約15km上流の堰では5月中旬がピーク。', '新潟県内水面水産試験場 報告', 'https://agriknowledge.affrc.go.jp/RN/2010835169.pdf']
    ]
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

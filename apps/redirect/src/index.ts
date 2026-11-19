/**
 * deadlock.jp を、デドロ字幕（https://jimaku.deadlock.jp/）へ転送する。
 * 配信者ボードは streamers.deadlock.jp に移した（apps/web）。前のボードのパス（/?period=… や /streamers/…）は
 * 字幕のサイトにないので、どのパスもトップへ送る
 */
export default {
	fetch(): Response {
		return Response.redirect('https://jimaku.deadlock.jp/', 301);
	},
};

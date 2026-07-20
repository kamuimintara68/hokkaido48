// 北海道48路線ふらふらlog Version 4.0
// メイン地図 走破中オレンジ表示 根本修正パッチ
(function () {
  "use strict";

  if (typeof getStatusColor === "function") {
    getStatusColor = function (status) {
      if (status === "走破済") {
        return "#16a34a";
      }

      // 未走破・走破中（一部走破）はメイン地図ではグレー表示。
      // 実走区間が確定していない路線全体をオレンジ表示しない。
      return "#6b7280";
    };
  }
})();

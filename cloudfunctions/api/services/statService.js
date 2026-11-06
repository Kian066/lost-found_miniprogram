// 统计的用例层
'use strict'

module.exports = function createStatService({ statRepo }) {
  return {
    async overview({ openid, mine }) {
      return statRepo.overview({ openid, mine: !!mine })
    }
  }
}

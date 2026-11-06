// 云存储数据访问：删除云文件（清理孤儿图）
'use strict'

module.exports = function createFileRepo(cloud) {
  return {
    /**
     * 批量删除云文件。fileID 不存在的会被云端忽略；整体失败不抛出。
     * @param {string[]} fileIds
     * @returns {Promise<{removed:number, failed:boolean}>}
     */
    async removeFiles(fileIds) {
      const list = (fileIds || []).filter(function (f) {
        return typeof f === 'string' && f.indexOf('cloud://') === 0
      })
      if (!list.length) return { removed: 0, failed: false }
      try {
        const r = await cloud.deleteFile({ fileList: list })
        const okCount = (r.fileList || []).filter(function (f) {
          return f.status === 0 || f.status === undefined
        }).length
        return { removed: okCount, failed: false }
      } catch (e) {
        console.warn('[fileRepo] 删除云文件失败:', e && e.message)
        return { removed: 0, failed: true }
      }
    },

    /**
     * 把云存储 fileID 批量换成可直接渲染的 HTTPS 临时链接。
     * 关键点：这里在云函数里执行，拥有管理员权限，不受云存储「仅创建者可读」
     * 这类 ACL 限制，因此换掉客户端直接解析的做法后，配图对所有人都可见。
     * @param {string[]} fileIds
     * @returns {Promise<Object>} fileID → https URL 的映射（失败的不会出现在结果里）
     */
    async toTempUrls(fileIds) {
      const list = (fileIds || []).filter(function (f) {
        return typeof f === 'string' && f.indexOf('cloud://') === 0
      })
      if (!list.length) return {}
      try {
        const r = await cloud.getTempFileURL({ fileList: list.slice(0, 50) })
        const map = {}
        ;(r.fileList || []).forEach(function (f) {
          if (f && f.fileID && f.tempFileURL) map[f.fileID] = f.tempFileURL
        })
        return map
      } catch (e) {
        console.warn('[fileRepo] 获取临时链接失败:', e && e.message)
        return {}
      }
    }
  }
}

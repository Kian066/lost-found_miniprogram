// components/item-card/item-card.js
const store = require('../../utils/store')

Component({
  properties: {
    item: {
      type: Object,
      value: null
    },
    best: {
      type: Number,
      value: 0
    }
  },

  data: {
    emoji: '📦',
    typeText: '',
    typeClass: '',
    feats: [],
    clueCount: 0,
    timeText: '',
    closed: false
  },

  observers: {
    'item': function (item) {
      if (!item) return
      this.setData({
        emoji: store.CAT_EMOJI[item.category] || '📦',
        typeText: item.type === 'lost' ? '寻物启事' : '失物招领',
        typeClass: item.type === 'lost' ? 'tag-lost' : 'tag-found',
        feats: (item.features || []).slice(0, 3),
        clueCount: (item.clues || []).length,
        closed: item.status === 'closed'
      })
    }
  },

  methods: {
    onTap() {
      this.triggerEvent('tap', { id: this.data.item ? this.data.item.id : '' })
    },
    onMasterTap() {
      this.triggerEvent('master', { id: this.data.item ? this.data.item.id : '' })
    }
  }
})

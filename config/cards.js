export const CARDS = {
  knight:  { name:'騎士', cost:3, type:'TROOP', damage:160, attackSpeed:1.2, speed:60, hp:1400, range:1.2, sightRange:5.5, targets:['ground','buildings'], class:'knight' },
  archer:  { name:'弓箭手', cost:3, type:'TROOP', damage:150, attackSpeed:1, speed:60, hp:250, range:5, sightRange:6, targets:['ground','air','buildings'], class:'archer' },
  giant:   { name:'巨人', cost:5, type:'TROOP', damage:200, attackSpeed:1.5, speed:45, hp:2000, range:1.2, sightRange:5.5, targets:['buildings'], class:'giant' },
  fireball:{ name:'火球', cost:4, type:'SPELL', damage:570, radius:2.5, class:'fireball' },
  k:  { name:'k', cost:3, type:'TROOP', damage:150, attackSpeed:1, speed:60, hp:1250, range:5, sightRange:6, targets:['ground','air','buildings'], class:'k' },

};
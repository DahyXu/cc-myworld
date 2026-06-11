// tests/run_all.js — 依次跑全部测试，任一失败即非零退出
'use strict';
const files = ['test_noise.js', 'test_blocks.js', 'test_world.js', 'test_mesher.js', 'test_player.js', 'test_interact.js', 'test_protocol.js', 'test_remote_edit.js'];
for (const f of files) require('./' + f);
console.log('ALL TESTS PASSED');

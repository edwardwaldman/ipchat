const urls = { a: '/?as=1.1.1.1', b: '/?as=1.2.3.4' };
const left = document.getElementById('a');
left.addEventListener('load', () => left.contentWindow.focus());
document.querySelectorAll('button').forEach(btn => btn.onclick = () => {
  const f = document.getElementById(btn.dataset.side);
  // "disconnect" acts like closing the tab; "reopen" is a fresh tab
  f.src = btn.dataset.act === 'close' ? 'about:blank' : urls[btn.dataset.side];
});

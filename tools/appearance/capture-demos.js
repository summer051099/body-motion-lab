async (page) => {
  await page.reload();
  await page.waitForFunction(() => window.veloraLab?.state.ready);
  const clips = [
    { exercise: 'pushup', repetitions: 1, view: 'oblique' },
    { exercise: 'squat', repetitions: 3, view: 'oblique' },
    { exercise: 'curl', repetitions: 1, view: 'oblique' },
  ];
  for (const clip of clips) {
    await page.evaluate(clip => {
      const v = window.veloraLab;
      v.setExercise(clip.exercise); v.setPhase(0); v.setView(clip.view);
      v.appearance.setMode('athlete');
      v.setExportSize(1280, 720);
    }, clip);
    const frameCount = 90 * clip.repetitions;
    for (let frame = 0; frame < frameCount; frame++) {
      const phase = (frame % 90) / 89;
      const downloadPromise = page.waitForEvent('download');
      await page.evaluate(({ phase, frame }) => {
        const v = window.veloraLab; v.setPhase(phase);
        const a = document.createElement('a');
        a.download = `frame-${String(frame).padStart(4,'0')}.png`;
        a.href = v.screenshot(); a.click();
      }, { phase, frame });
      const download = await downloadPromise;
      await download.saveAs(`output/appearance/clips/${clip.exercise}/frame-${String(frame).padStart(4, '0')}.png`);
    }
  }
  await page.evaluate(() => { veloraLab.restoreSize(); veloraLab.setExercise('squat'); veloraLab.setPhase(0); });
}

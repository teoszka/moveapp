// Routine content. Based on two Elastaboy videos (transcripts checked 2026-10-28); descriptions are our own words.
// Exercise fields: dur = work seconds, prep = transition seconds before it (default in app.js), sides = switch side halfway,
// t = moment in the video (seconds), poses/cycle/anchor/ease/open = animation (see figure.js). No poses = placeholder figure.

const SQUAT = [
  { t: 35, h: 20, c: 4, aN: [150, 40], aF: [145, 35], lN: [80, 215, 90], lF: [76, 212, 90] },
  { t: 27, h: 10, c: 2, aN: [155, 45], aF: [150, 40], lN: [85, 218, 90], lF: [81, 215, 90] },
];

const CAT_COW = [
  { t: 76, h: 165, c: 10, aN: [180, 180], aF: [176, 176], lN: [180, 270, 270], lF: [176, 270, 270] },
  { t: 76, h: 55, c: -9, aN: [180, 180], aF: [176, 176], lN: [180, 270, 270], lF: [176, 270, 270] },
];

window.ROUTINES = {
  morning: {
    id: 'morning',
    title: 'Poranek',
    tagline: 'Obudź ciało w 3 krokach',
    intro: 'Ciało budzi się w ustalonej kolejności: najpierw układ nerwowy, potem stawy, na końcu tkanki pod obciążeniem. Zrób to przed pierwszą kawą.',
    icon: 'sun',
    accent: '#f5a524',
    video: '_SdJ6kX2vu0',
    workLabel: 'Ćwicz',
    doneText: 'Miłego dnia!',
    rate: 1,
    items: [
      {
        id: 'knee-hug', group: 'Krok 1 · Rozbudzenie układu nerwowego',
        name: 'Przytulenie kolan', en: 'Knee hug rock', dur: 30, t: 198,
        cues: ['Leżąc na plecach (może być w łóżku), przyciągnij kolana do klatki', 'Delikatnie kołysz się na boki', 'To sygnał dla kręgosłupa, a nie rozciąganie'],
        avoid: 'Gwałtownego bujania',
      },
      {
        id: 'cat-cow', group: 'Krok 1 · Rozbudzenie układu nerwowego',
        name: 'Koci grzbiet', en: 'Cat-cow', dur: 30, prep: 10, t: 214,
        poses: CAT_COW, cycle: 6, anchor: 'kneeN',
        cues: ['Klęk podparty: dłonie pod barkami, kolana pod biodrami', 'Na zmianę zaokrąglaj plecy i wyginaj je w dół, unosząc głowę', 'Powoli, w pełnym zakresie ruchu'],
        avoid: 'Pośpiechu i blokowania łokci',
      },
      {
        id: 'neck-cars', group: 'Krok 2 · Rotacje stawów (CARs)',
        name: 'Krążenia głowy', en: 'Neck CARs', dur: 20, prep: 8, t: 267,
        cues: ['3 powolne kręgi w każdą stronę', 'Poczuj każdą pozycję po drodze'],
        avoid: 'Szarpania i odchylania głowy na siłę',
      },
      {
        id: 'shoulder-cars', group: 'Krok 2 · Rotacje stawów (CARs)',
        name: 'Krążenia ramion', en: 'Shoulder CARs', dur: 20, t: 273,
        cues: ['3 kręgi w każdą stronę', 'Tak szeroko, jak potrafisz'],
        avoid: 'Unoszenia barków do uszu',
      },
      {
        id: 'hip-cars', group: 'Krok 2 · Rotacje stawów (CARs)',
        name: 'Krążenia bioder', en: 'Hip CARs', dur: 30, sides: true, t: 279,
        cues: ['Stojąc, unieś kolano i zatocz nim szeroki krąg', '3 kręgi do środka i 3 na zewnątrz, potem druga noga', 'Możesz przytrzymać się ściany'],
        avoid: 'Bujania tułowiem',
      },
      {
        id: 'ankle-cars', group: 'Krok 2 · Rotacje stawów (CARs)',
        name: 'Krążenia stóp', en: 'Ankle CARs', dur: 20, sides: true, t: 288,
        cues: ['3 kręgi w każdą stronę', 'Dochodź do granicy zakresu ruchu'],
        avoid: 'Szybkiego, niedbałego kręcenia',
      },
      {
        id: 'deep-squat', group: 'Krok 3 · Pozycje z obciążeniem',
        name: 'Głęboki przysiad', en: 'Deep squat', dur: 30, t: 341,
        poses: SQUAT, cycle: 5, anchor: 'ankleN',
        cues: ['Zejdź tak nisko, jak możesz, i zostań na dole', 'Przenoś ciężar z boku na bok', 'Rób to, co jest przyjemne: otwierasz biodra, kostki i lędźwie'],
        avoid: 'Bólu w kolanach: wtedy zmniejsz głębokość',
      },
      {
        id: 'wgs', group: 'Krok 3 · Pozycje z obciążeniem',
        name: 'Najlepsze rozciąganie świata', en: "World's greatest stretch", dur: 60, sides: true, t: 359,
        cues: ['Wykrok, przednia dłoń po wewnętrznej stronie stopy', 'Drugą rękę obróć w górę, do sufitu', '30 sekund na każdą stronę'],
        avoid: 'Opadania tylnego kolana bez kontroli',
      },
      {
        id: 'dog-cobra', group: 'Krok 3 · Pozycje z obciążeniem',
        name: 'Pies z głową w dół i kobra', en: 'Downward dog to cobra', dur: 30, prep: 8, t: 379,
        cues: ['Płynnie przechodź między obiema pozycjami', 'W psie dociskaj pięty do podłogi', 'W kobrze pchnij biodra w przód i ściśnij pośladki'],
        avoid: 'Zapadania się w barkach',
      },
      {
        id: 'side-bend', group: 'Krok 3 · Pozycje z obciążeniem',
        name: 'Skłon boczny z sięgnięciem', en: 'Standing side bend', dur: 30, sides: true, prep: 8, t: 403,
        cues: ['Jedna ręka nad głowę, skłon w przeciwną stronę', 'Oddychaj w rozciąganą stronę', 'W połowie zmiana strony'],
        avoid: 'Pochylania się do przodu',
      },
      {
        id: 'hinge-reach', group: 'Krok 3 · Pozycje z obciążeniem',
        name: 'Zawias biodrowy z sięgnięciem', en: 'Hinge to reach', dur: 30, t: 419,
        cues: ['Pochyl się z bioder jak w martwym ciągu rumuńskim', 'Wyprostuj się i sięgnij rękami nad głowę', 'Płynnie, w rytmie oddechu'],
        avoid: 'Zaokrąglania pleców przy pochyleniu',
      },
    ],
  },

  evening: {
    id: 'evening',
    title: 'Wieczór',
    tagline: 'Wycisz się przed snem',
    intro: 'Cztery spokojne pozycje, po 2 minuty. Nie chodzi o rozciąganie, tylko o zwolnienie tętna przed snem. Oddech pudełkowy: wdech 4 s, pauza 4 s, wydech 4 s, pauza 4 s.',
    icon: 'moon',
    accent: '#8b9cff',
    video: '3thDsnn6KR4',
    workLabel: 'Oddychaj',
    doneText: 'Dobrej nocy!',
    rate: 0.9,
    items: [
      {
        id: 'relaxed-squat',
        name: 'Luźny głęboki przysiad', en: 'Relaxed deep squat', dur: 120, t: 40, breath: 'box',
        poses: SQUAT, cycle: 8, anchor: 'ankleN',
        cues: ['Zamknij oczy i skup się na oddechu', 'Nie walcz o głębokość ani o rozciąganie', 'Oddech pudełkowy: 4 s wdech, 4 s pauza, 4 s wydech, 4 s pauza'],
        avoid: 'Dążenia do idealnej formy',
      },
      {
        id: 'butterfly',
        name: 'Motyl z pulsowaniem', en: 'Butterfly pulses', dur: 120, prep: 8, t: 144,
        cues: ['Usiądź, złącz stopy i chwyć je dłońmi', 'Delikatnie pochylaj się w przód i wracaj', 'Wdech przy pochyleniu, powolny wydech przy powrocie'],
        avoid: 'Ciągnięcia i szarpania',
      },
      {
        id: 'frog',
        name: 'Żaba', en: 'Frog pose', dur: 120, prep: 8, t: 284, breath: 'box',
        cues: ['Klęk podparty, kolana szeroko: im szerzej, tym mocniej', 'Stopy w linii z kolanami albo trochę szerzej', 'Delikatnie kołysz się w przód i w tył'],
        avoid: 'Forsowania: to najintensywniejsza pozycja wieczoru',
      },
      {
        id: 'child',
        name: 'Pozycja dziecka', en: "Child's pose", dur: 120, prep: 8, t: 455, breath: 'box',
        cues: ['Kolana szeroko, stopy prawie złączone', 'Sięgnij rękami daleko w przód, czoło na podłogę', 'Poczuj, jak odpuszcza odcinek lędźwiowy'],
        avoid: 'Gwałtownego wychodzenia z pozycji',
      },
    ],
  },
};

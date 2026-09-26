# 소리담 자장

아이 재울 때 쓰는 아이폰용 웹앱. 인터넷·계정·광고 없이 기기 안에서만 동작한다.

## 설계 원칙: 화면이 꺼져도 소리가 끊기지 않을 것
- iOS 웹앱에서 Web Audio(AudioContext)는 화면이 꺼지면 약 30초 뒤 멈춘다. 그래서 쓰지 않는다.
- 항상 `<audio>` 요소 **하나**로만 재생한다. 곡이 바뀔 때도 같은 요소에 `src`만 바꾼다.
- 자장가 + 빗소리는 실시간으로 섞지 않고, `scripts/prepare-audio.sh`로 미리 섞은 파일을 쓴다.
- 결과: iOS에서는 앱 안 볼륨 조절과 타이머 페이드아웃이 안 된다(아이폰 볼륨 버튼 사용, 타이머는 바로 정지).

## 음원 만들기 (맥)
```bash
bash scripts/prepare-audio.sh   # 약 3분. ~/Music/소리담/다운로드 원본은 읽기만 함
```
`audio/`에 5개 파일(약 136MB)이 생긴다: `noise`, `brahms`, `bebefinn`, `brahms-mix`, `bebefinn-mix` (.m4a)

## 개발
```bash
npm test          # 로직 테스트
npm run serve     # http://localhost:8766 (audio/ 폴더를 바로 사용)
```

## 아이폰에 설치
1. 앱 주소: https://ddongkkoo100-star.github.io/sorida-sleep/ (GitHub Pages, 음원 제외). 음원은 저작권 때문에 올리지 않는다.
2. 음원 5개는 iCloud Drive의 **소리담 음원** 폴더에 있다(아이폰 ‘파일’ 앱 → iCloud Drive).
3. 아이폰 Safari로 주소 열기 → 공유 → **홈 화면에 추가**.
4. 홈 화면 앱 실행 → ⚙︎ → **음원 파일 선택** → 5개 모두 선택.
5. ⚙︎ → **잠금 테스트**로 화면이 꺼진 상태에서 동작하는지 확인.
   - 홈 화면 앱에서 실패하면 Safari 탭에서 열어 같은 과정을 반복(저장소가 따로라 음원도 다시 가져와야 함).

## 음원 저작권
유튜브에서 받은 음원(베베핀 = 더핑크퐁컴퍼니)은 가족 기기 개인용으로만 쓴다. `audio/`는 `.gitignore`에 있다.

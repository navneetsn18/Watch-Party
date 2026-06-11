const { execSync } = require('child_process');

console.log("=== FFmpeg Detection Tool ===");
try {
  const ffmpegPath = execSync('which ffmpeg', { encoding: 'utf-8' }).trim();
  console.log(`✅ FFmpeg found at: ${ffmpegPath}`);
  const version = execSync('ffmpeg -version', { encoding: 'utf-8' }).split('\n')[0];
  console.log(`ℹ️ Version info: ${version}`);
} catch (error) {
  console.log('❌ FFmpeg NOT found in system PATH.');
  console.log('\nTo install FFmpeg on your EC2 instance (Source Compilation):');
  console.log('----------------------------------------------------');
  console.log('1. Install required dependencies:');
  console.log('   sudo yum install -y yasm nasm autoconf automake bzip2 bzip2-devel cmake freetype-devel gcc gcc-c++ git libtool make pkgconfig zlib-devel');
  console.log('2. Download & extract FFmpeg source:');
  console.log('   mkdir ~/ffmpeg_sources && cd ~/ffmpeg_sources');
  console.log('   curl -O -L https://ffmpeg.org/releases/ffmpeg-snapshot.tar.bz2');
  console.log('   tar xjvf ffmpeg-snapshot.tar.bz2 && cd ffmpeg');
  console.log('3. Configure build (copy/paste as one command):');
  console.log('   ./configure --prefix="/opt/ffmpeg" --bindir="/opt/ffmpeg/bin" --extra-cflags="-I/opt/ffmpeg/include -fstack-protector-strong -fpie -pie -Wl,-z,relro,-z,now -D_FORTIFY_SOURCE=2" --extra-ldflags="-L/opt/ffmpeg/lib" --extra-libs=-lpthread --extra-libs=-lm --enable-libfreetype --disable-static --enable-shared --enable-rpath');
  console.log('4. Compile & install:');
  console.log('   make -j$(nproc) && sudo make install && sudo ldconfig');
  console.log('5. Add system-wide configuration:');
  console.log("   sudo sh -c 'cat > /etc/systemd/system.conf.d/ffmpeg.conf << EOL");
  console.log('   [Manager]');
  console.log('   DefaultEnvironment=PATH=/opt/ffmpeg/bin:$PATH');
  console.log('   DefaultEnvironment=LD_LIBRARY_PATH=/opt/ffmpeg/lib:$LD_LIBRARY_PATH');
  console.log("   EOL'");
  console.log('6. Reload systemd & reboot:');
  console.log('   sudo systemctl daemon-reexec');
  console.log('   sudo reboot');
  console.log('----------------------------------------------------');
  console.log('After rebooting, verify with: ffmpeg -version');
  console.log('And restart your Node.js application to start transcoding!');
}

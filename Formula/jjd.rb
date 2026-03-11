class Jjd < Formula
  desc "Jujutsu automation daemon — auto-describe, bookmark, and push with AI"
  homepage "https://github.com/wsoule/jjd"
  version "0.1.0"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/wsoule/jjd/releases/download/v#{version}/jjd-darwin-arm64.tar.gz"
      sha256 "PLACEHOLDER"
    else
      url "https://github.com/wsoule/jjd/releases/download/v#{version}/jjd-darwin-x64.tar.gz"
      sha256 "PLACEHOLDER"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/wsoule/jjd/releases/download/v#{version}/jjd-linux-arm64.tar.gz"
      sha256 "PLACEHOLDER"
    else
      url "https://github.com/wsoule/jjd/releases/download/v#{version}/jjd-linux-x64.tar.gz"
      sha256 "PLACEHOLDER"
    end
  end

  depends_on "jj"

  def install
    bin.install "jjd"
  end

  def post_install
    puts ""
    puts "jjd #{version} installed!"
    puts ""
    puts "Get started:"
    puts "  cd your-jj-repo"
    puts "  export ANTHROPIC_API_KEY=sk-ant-..."
    puts "  jjd init                             # one-time repo setup"
    puts ""
    puts "Then start coding:"
    puts "  jjd session start ENG-123 --claude   # with a Linear task"
    puts "  jjd session start my-feature --claude # without Linear"
    puts ""
    puts "Or use Claude Code's native /worktree — jjd starts automatically."
    puts ""
    puts "Docs: https://github.com/wsoule/jjd"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/jjd --version")
    assert_match "Usage", shell_output("#{bin}/jjd help")
  end

  livecheck do
    url :stable
    strategy :github_latest
  end
end

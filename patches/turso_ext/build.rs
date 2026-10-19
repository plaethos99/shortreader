fn main() {
    // Guard on the COMPILE TARGET, not the host: `cfg!(target_os)` in a build
    // script evaluates the host, which wrongly linked advapi32 (a Windows lib)
    // when cross-compiling from Windows to Android.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        println!("cargo:rustc-link-lib=advapi32");
    }
}

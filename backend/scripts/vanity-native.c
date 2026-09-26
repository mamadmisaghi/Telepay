// Local-only CSPRNG vanity generation. Link against libsodium; never logs keys.
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdatomic.h>
#include <pthread.h>
#include <time.h>
#include <fcntl.h>
#include <unistd.h>
extern int sodium_init(void);
extern int crypto_sign_keypair(unsigned char *, unsigned char *);
static atomic_int found=0;
static int target=8;
static uint64_t suffix_value=0,modulus=1;
static FILE *output;
static time_t started;
static int seconds=900,thread_count=4;
static pthread_mutex_t lock=PTHREAD_MUTEX_INITIALIZER;
static void *run(void *unused){
 unsigned char pk[32],sk[64];
 while(atomic_load(&found)<target && time(NULL)-started<seconds){
  if(crypto_sign_keypair(pk,sk)!=0)exit(2);
  uint64_t value=0;
  for(int j=0;j<32;j++)value=(value*256+pk[j])%modulus;
  if(value!=suffix_value)continue;
  pthread_mutex_lock(&lock);
  if(atomic_load(&found)<target){
   for(int j=0;j<64;j++)fprintf(output,"%02x",sk[j]);
   fputc('\n',output);fflush(output);atomic_fetch_add(&found,1);
   fprintf(stderr,"Ready mint count: %d\n",atomic_load(&found));
  }
  pthread_mutex_unlock(&lock);
 }
 memset(sk,0,sizeof(sk));return NULL;
}
int main(int argc,char **argv){
 if((argc<3||argc>5)||sodium_init()<0)return 2;
 if(argc>=4)seconds=atoi(argv[3]);if(argc>=5)thread_count=atoi(argv[4]);
 if(seconds<1||seconds>900||thread_count<1||thread_count>4)return 2;
 target=atoi(argv[2]);if(target<1||target>32)return 2;
 const char *alphabet="123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz",*suffix="TeLe";
 for(int j=0;j<4;j++){modulus*=58;suffix_value=suffix_value*58+(strchr(alphabet,suffix[j])-alphabet);}
 int fd=open(argv[1],O_WRONLY|O_CREAT|O_EXCL,0600);if(fd<0)return 2;
 output=fdopen(fd,"w");started=time(NULL);pthread_t threads[4];
 for(int j=0;j<thread_count;j++)pthread_create(&threads[j],NULL,run,NULL);
 for(int j=0;j<thread_count;j++)pthread_join(threads[j],NULL);
 fclose(output);return atomic_load(&found)==target?0:1;
}
